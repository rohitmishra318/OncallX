import 'dotenv/config';
import axios from 'axios';
import type { ActiveTarget, TargetState, JobEntry } from './types';
import { checkTarget, processTick } from './checker';

const ONCALLX_API_URL = process.env.ONCALLX_API_URL ?? 'http://localhost:4000';
const INTERNAL_MONITOR_KEY = process.env.INTERNAL_MONITOR_KEY ?? '';
const TARGET_POLL_INTERVAL_MS = 60_000; // how often to re-fetch the active target list

// ─── In-memory job map: targetId → running job entry ─────────────────────────
const jobs = new Map<string, JobEntry>();

// ─── Fetch active targets from the API ───────────────────────────────────────

async function fetchActiveTargets(): Promise<ActiveTarget[]> {
  try {
    const { data } = await axios.get(`${ONCALLX_API_URL}/monitoring/targets/active`, {
      headers: { 'x-internal-key': INTERNAL_MONITOR_KEY },
      timeout: 10_000,
    });
    return data.targets as ActiveTarget[];
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[monitor] Failed to fetch active targets: ${message}`);
    return [];
  }
}

// ─── Start a check loop for one target ───────────────────────────────────────

function startTarget(target: ActiveTarget): void {
  const state: TargetState = {
    consecutiveFailures: 0,
    consecutiveSuccesses: 0,
    isDown: false,
    lastSslAlertDate: null,
  };

  const runCheck = async () => {
    const result = await checkTarget(target);
    await processTick(target, result, state);
  };

  runCheck(); // immediate first check
  const intervalHandle = setInterval(runCheck, target.intervalMs);

  jobs.set(target.id, { target, state, intervalHandle });

  console.info(
    `[monitor] ▶ Watching "${target.name}" (${target.id}) @ ${target.url} — ` +
      `interval ${target.intervalMs}ms, failureThreshold=${target.failureThreshold}`
  );
}

// ─── Stop a check loop for one target ────────────────────────────────────────

function stopTarget(id: string): void {
  const entry = jobs.get(id);
  if (!entry) return;
  clearInterval(entry.intervalHandle);
  jobs.delete(id);
  console.info(`[monitor] ■ Stopped watching "${entry.target.name}" (${id})`);
}

// ─── Diff and apply the latest target list ────────────────────────────────────
// §17.5 — Core engineering requirement: diff, don't restart everything.

function applyTargetList(latest: ActiveTarget[]): void {
  const latestIds = new Set(latest.map((t) => t.id));

  // Stop targets that are no longer active
  for (const id of jobs.keys()) {
    if (!latestIds.has(id)) {
      stopTarget(id);
    }
  }

  // Start new targets
  for (const target of latest) {
    if (!jobs.has(target.id)) {
      startTarget(target);
    }
    // Existing targets whose config may have changed: leave the running interval
    // untouched (spec §17.5: "leave its running interval untouched, do not restart it").
    // A config change takes effect on the next monitor poll cycle which re-creates the job.
    // Note: to pick up intervalMs changes we'd need to restart the job — but the spec is
    // explicit that we must NOT restart, so config changes to intervalMs only take effect
    // after the old job is removed (target deactivated then re-activated).
  }

  console.debug(`[monitor] Sync complete — ${jobs.size} target(s) running`);
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  if (!INTERNAL_MONITOR_KEY) {
    console.error(
      '[monitor] FATAL: INTERNAL_MONITOR_KEY is not set. ' +
        'Set it in apps/monitor/.env (must match the API server value).'
    );
    process.exit(1);
  }

  console.info(`[monitor] Starting — OnCallX API: ${ONCALLX_API_URL}`);
  console.info(`[monitor] Will poll for new targets every ${TARGET_POLL_INTERVAL_MS / 1000}s`);

  // Initial load
  const initial = await fetchActiveTargets();
  applyTargetList(initial);

  if (initial.length === 0) {
    console.warn(
      '[monitor] No active targets found on startup. ' +
        'Create a MonitorTarget via the dashboard and it will be picked up within 60s.'
    );
  }

  // Recurring diff poll
  setInterval(async () => {
    const latest = await fetchActiveTargets();
    applyTargetList(latest);
  }, TARGET_POLL_INTERVAL_MS);
}

// ─── Graceful shutdown ────────────────────────────────────────────────────────

process.on('SIGINT', () => {
  console.info('[monitor] Shutting down (SIGINT)');
  for (const id of jobs.keys()) stopTarget(id);
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.info('[monitor] Shutting down (SIGTERM)');
  for (const id of jobs.keys()) stopTarget(id);
  process.exit(0);
});

main().catch((err) => {
  console.error('[monitor] Unexpected error:', err);
  process.exit(1);
});
