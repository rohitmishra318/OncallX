import axios from 'axios';
import tls from 'tls';
import type { ActiveTarget, TargetState, CheckResult } from './types';
import { isUrlSafeToFetch } from './ssrf';

const ONCALLX_API_URL = process.env.ONCALLX_API_URL ?? 'http://localhost:4000';
const INTERNAL_MONITOR_KEY = process.env.INTERNAL_MONITOR_KEY ?? '';
const DEFAULT_SSL_EXPIRY_THRESHOLD_DAYS = 14;

const internalHeaders = {
  'x-internal-key': INTERNAL_MONITOR_KEY,
  'Content-Type': 'application/json',
};

// ─── HTTP check ───────────────────────────────────────────────────────────────

export async function checkTarget(target: ActiveTarget): Promise<CheckResult> {
  // §17.4.3 — Re-validate URL immediately before every request (DNS rebinding defense)
  const safe = await isUrlSafeToFetch(target.url);
  if (!safe) {
    return {
      success: false,
      statusCode: null,
      latencyMs: 0,
      error: 'SSRF check failed — URL resolved to a blocked address at check time',
    };
  }

  const start = Date.now();
  try {
    const response = await axios.get(target.url, {
      timeout: target.timeoutMs,
      validateStatus: () => true,
      // §17.4.4 — No automatic redirect following to prevent redirect-based SSRF
      maxRedirects: 0,
    });
    const latencyMs = Date.now() - start;
    const success = response.status === target.expectedStatus;
    return { success, statusCode: response.status, latencyMs };
  } catch (err: unknown) {
    const latencyMs = Date.now() - start;
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, statusCode: null, latencyMs, error: message };
  }
}

// ─── SSL certificate expiry check ─────────────────────────────────────────────

async function getSslExpiryDays(hostname: string): Promise<number | null> {
  return new Promise((resolve) => {
    const socket = tls.connect({ host: hostname, port: 443, servername: hostname }, () => {
      const cert = socket.getPeerCertificate();
      socket.destroy();
      if (!cert || !cert.valid_to) {
        resolve(null);
        return;
      }
      const expiresAt = new Date(cert.valid_to);
      const daysLeft = Math.floor((expiresAt.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
      resolve(daysLeft);
    });
    socket.on('error', () => { socket.destroy(); resolve(null); });
    socket.setTimeout(5000, () => { socket.destroy(); resolve(null); });
  });
}

// ─── Internal API calls ───────────────────────────────────────────────────────

/** §17.5 — Log every check result via the internal endpoint */
function logCheckResult(target: ActiveTarget, result: CheckResult): void {
  axios
    .post(
      `${ONCALLX_API_URL}/internal/check-results`,
      {
        targetId: target.id, // UUID — resolved server-side to target.name for CheckResult.targetId
        success: result.success,
        statusCode: result.statusCode,
        latencyMs: result.latencyMs,
      },
      { headers: internalHeaders, timeout: 5000 }
    )
    .catch((err: Error) => {
      console.debug(`[monitor] check-result log failed for ${target.name}: ${err.message}`);
    });
}

/** §17.5 — Report threshold-crossing failure (fires the Section 6 pipeline server-side) */
async function fireAlert(target: ActiveTarget, consecutiveFailures: number): Promise<void> {
  try {
    await axios.post(
      `${ONCALLX_API_URL}/internal/target-alert`,
      { targetId: target.id, event: 'down', consecutiveFailures },
      { headers: internalHeaders, timeout: 10000 }
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[monitor] Failed to fire alert for ${target.name}: ${message}`);
  }
}

/** §17.5 — Report recovery (auto-resolves the open incident server-side) */
async function autoResolve(target: ActiveTarget): Promise<void> {
  try {
    await axios.post(
      `${ONCALLX_API_URL}/internal/target-alert`,
      { targetId: target.id, event: 'up' },
      { headers: internalHeaders, timeout: 10000 }
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[monitor] Failed to auto-resolve for ${target.name}: ${message}`);
  }
}

// ─── SSL expiry check (unchanged from Phase 16) ───────────────────────────────

async function checkSslExpiry(
  target: ActiveTarget,
  state: TargetState,
  timestamp: string
): Promise<void> {
  if (!target.url.startsWith('https://')) return;

  const thresholdDays = DEFAULT_SSL_EXPIRY_THRESHOLD_DAYS;
  if (thresholdDays <= 0) return;

  const today = new Date().toISOString().slice(0, 10);
  if (state.lastSslAlertDate === today) return;

  const hostname = new URL(target.url).hostname;
  const daysLeft = await getSslExpiryDays(hostname);

  if (daysLeft === null) {
    console.debug(`[${timestamp}] [DEBUG] ${target.name}: could not inspect SSL certificate`);
    return;
  }

  console.debug(`[${timestamp}] [DEBUG] ${target.name}: SSL cert expires in ${daysLeft} days`);

  if (daysLeft <= thresholdDays) {
    console.info(
      `[${timestamp}] [INFO ] ${target.name}: SSL cert expires in ${daysLeft} days — firing MEDIUM alert`
    );
    try {
      // SSL expiry alerts still go through the internal pipeline — we need a serviceId for them
      await axios.post(
        `${ONCALLX_API_URL}/internal/target-alert`,
        {
          targetId: target.id,
          event: 'down',
          // Using a distinctive consecutiveFailures=0 sentinel so the server
          // can title it differently if desired in the future
          consecutiveFailures: 0,
        },
        { headers: internalHeaders, timeout: 10000 }
      );
      state.lastSslAlertDate = today;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[monitor] Failed to fire SSL expiry alert for ${target.name}: ${message}`);
    }
  }
}

// ─── State machine tick ───────────────────────────────────────────────────────

/**
 * Process one check result against the current per-target state.
 * Mutates `state` in place and fires internal API calls as needed.
 */
export async function processTick(
  target: ActiveTarget,
  result: CheckResult,
  state: TargetState
): Promise<void> {
  const timestamp = new Date().toISOString();

  // §17.5 — Log every check (fire-and-forget)
  logCheckResult(target, result);

  // §16.8 — SSL expiry check (HTTPS targets only, rate-limited once/day)
  checkSslExpiry(target, state, timestamp).catch((err: Error) => {
    console.debug(`[monitor] SSL check error for ${target.name}: ${err.message}`);
  });

  if (result.success) {
    state.consecutiveFailures = 0;
    state.consecutiveSuccesses += 1;

    console.debug(
      `[${timestamp}] [DEBUG] ${target.name} OK (HTTP ${result.statusCode}, ${result.latencyMs}ms, ` +
        `consecutiveSuccesses=${state.consecutiveSuccesses})`
    );

    if (state.isDown && state.consecutiveSuccesses >= target.successThreshold) {
      console.info(
        `[${timestamp}] [INFO ] ${target.name} recovered after ${state.consecutiveSuccesses} successes — auto-resolving`
      );
      state.isDown = false;
      state.consecutiveSuccesses = 0;
      await autoResolve(target);
    }
  } else {
    state.consecutiveSuccesses = 0;
    state.consecutiveFailures += 1;

    const reason = result.error ?? `HTTP ${result.statusCode ?? 'N/A'}`;
    console.debug(
      `[${timestamp}] [DEBUG] ${target.name} FAIL (${reason}, ${result.latencyMs}ms, ` +
        `consecutiveFailures=${state.consecutiveFailures}/${target.failureThreshold})`
    );

    if (!state.isDown && state.consecutiveFailures >= target.failureThreshold) {
      console.info(
        `[${timestamp}] [INFO ] ${target.name} DOWN — threshold crossed ` +
          `(${state.consecutiveFailures} consecutive failures), firing alert`
      );
      state.isDown = true;
      await fireAlert(target, state.consecutiveFailures);
    } else if (state.isDown) {
      console.debug(
        `[${timestamp}] [DEBUG] ${target.name} still DOWN (${state.consecutiveFailures} consecutive failures)`
      );
    }
  }
}
