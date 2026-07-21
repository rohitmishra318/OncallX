import path from 'path';
import fs from 'fs';
import 'dotenv/config';
import type { TargetConfig, TargetState } from './types';
import { checkTarget, processTick } from './checker';

// ─── Load targets ─────────────────────────────────────────────────────────────

const targetsPath = path.resolve(__dirname, '..', 'targets.json');

if (!fs.existsSync(targetsPath)) {
  console.error(
    `[monitor] ERROR: targets.json not found at ${targetsPath}\n` +
      `         Copy targets.example.json to targets.json and fill in your values.`
  );
  process.exit(1);
}

const rawTargets: TargetConfig[] = JSON.parse(fs.readFileSync(targetsPath, 'utf-8'));

// ─── Resolve API keys from env ────────────────────────────────────────────────

interface ResolvedTarget {
  config: TargetConfig;
  apiKey: string;
}

const targets: ResolvedTarget[] = rawTargets.map((t) => {
  const apiKey = process.env[t.apiKeyEnvVar];
  if (!apiKey) {
    console.error(
      `[monitor] ERROR: environment variable "${t.apiKeyEnvVar}" is not set ` +
        `(required for target "${t.name}")`
    );
    process.exit(1);
  }
  return { config: t, apiKey };
});

// ─── Per-target in-memory state ───────────────────────────────────────────────

const states = new Map<string, TargetState>();

for (const { config } of targets) {
  states.set(config.name, {
    consecutiveFailures: 0,
    consecutiveSuccesses: 0,
    isDown: false,
    openIncidentId: null,
    lastSslAlertDate: null,
  });
}

// ─── Polling loop ─────────────────────────────────────────────────────────────

console.info(`[monitor] Starting — watching ${targets.length} target(s)`);
console.info(`[monitor] OnCallX API: ${process.env.ONCALLX_API_URL ?? 'http://localhost:4000'}`);

for (const { config, apiKey } of targets) {
  const state = states.get(config.name)!;

  // Run the first check immediately on startup, then on each interval
  const runCheck = async () => {
    const result = await checkTarget(config);
    await processTick(config, apiKey, result, state);
  };

  runCheck(); // immediate first check
  setInterval(runCheck, config.intervalMs);

  console.info(
    `[monitor] Watching "${config.name}" @ ${config.url} ` +
      `— interval ${config.intervalMs}ms, failureThreshold=${config.failureThreshold}, successThreshold=${config.successThreshold}`
  );
}

// ─── Graceful shutdown ────────────────────────────────────────────────────────

process.on('SIGINT', () => {
  console.info('[monitor] Shutting down (SIGINT)');
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.info('[monitor] Shutting down (SIGTERM)');
  process.exit(0);
});
