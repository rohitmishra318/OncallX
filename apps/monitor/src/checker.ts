import axios from 'axios';
import type { TargetConfig, TargetState, CheckResult } from './types';

const ONCALLX_API_URL = process.env.ONCALLX_API_URL ?? 'http://localhost:4000';

// ─── HTTP check ──────────────────────────────────────────────────────────────

export async function checkTarget(target: TargetConfig): Promise<CheckResult> {
  const start = Date.now();
  try {
    const response = await axios.get(target.url, {
      timeout: target.timeoutMs,
      // Don't throw on non-2xx — we want to capture the status code ourselves
      validateStatus: () => true,
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

// ─── OnCallX integration ──────────────────────────────────────────────────────

async function fireAlert(target: TargetConfig, apiKey: string, failures: number): Promise<string | null> {
  try {
    const response = await axios.post(
      `${ONCALLX_API_URL}/alerts`,
      {
        dedupKey: target.name,
        severity: 'HIGH',
        title: `${target.name} failed health check ${failures} consecutive time(s)`,
      },
      {
        headers: { 'x-api-key': apiKey, 'Content-Type': 'application/json' },
        timeout: 10000,
      }
    );
    const incidentId: string | null = response.data?.incidentId ?? null;
    return incidentId;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[monitor] Failed to fire alert for ${target.name}: ${message}`);
    return null;
  }
}

async function autoResolve(target: TargetConfig, apiKey: string): Promise<void> {
  try {
    await axios.post(
      `${ONCALLX_API_URL}/alerts/resolve`,
      { dedupKey: target.name },
      {
        headers: { 'x-api-key': apiKey, 'Content-Type': 'application/json' },
        timeout: 10000,
      }
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[monitor] Failed to auto-resolve incident for ${target.name}: ${message}`);
  }
}

// ─── State machine tick ───────────────────────────────────────────────────────

/**
 * Process one check result against the current per-target state.
 * Mutates `state` in place and fires OnCallX calls as needed.
 */
export async function processTick(
  target: TargetConfig,
  apiKey: string,
  result: CheckResult,
  state: TargetState
): Promise<void> {
  const timestamp = new Date().toISOString();

  if (result.success) {
    // ── Healthy check ────────────────────────────────────────────────────────
    state.consecutiveFailures = 0;
    state.consecutiveSuccesses += 1;

    console.debug(
      `[${timestamp}] [DEBUG] ${target.name} OK (HTTP ${result.statusCode}, ${result.latencyMs}ms, ` +
        `consecutiveSuccesses=${state.consecutiveSuccesses})`
    );

    if (state.isDown && state.consecutiveSuccesses >= target.successThreshold) {
      // Transition: DOWN → UP
      console.info(
        `[${timestamp}] [INFO ] ${target.name} recovered after ${state.consecutiveSuccesses} consecutive successes — ` +
          `auto-resolving incident`
      );
      state.isDown = false;
      state.consecutiveSuccesses = 0;
      state.openIncidentId = null;
      await autoResolve(target, apiKey);
    }
  } else {
    // ── Failed check ─────────────────────────────────────────────────────────
    state.consecutiveSuccesses = 0;
    state.consecutiveFailures += 1;

    const reason = result.error ?? `HTTP ${result.statusCode ?? 'N/A'}`;
    console.debug(
      `[${timestamp}] [DEBUG] ${target.name} FAIL (${reason}, ${result.latencyMs}ms, ` +
        `consecutiveFailures=${state.consecutiveFailures}/${target.failureThreshold})`
    );

    if (!state.isDown && state.consecutiveFailures >= target.failureThreshold) {
      // Transition: UP → DOWN
      console.info(
        `[${timestamp}] [INFO ] ${target.name} DOWN — threshold crossed ` +
          `(${state.consecutiveFailures} consecutive failures), firing OnCallX alert`
      );
      state.isDown = true;
      const incidentId = await fireAlert(target, apiKey, state.consecutiveFailures);
      if (incidentId) {
        state.openIncidentId = incidentId;
        console.info(`[${timestamp}] [INFO ] OnCallX incident created: ${incidentId}`);
      }
    } else if (state.isDown) {
      // Already down — just log, don't re-fire (dedup handles it on the server)
      console.debug(
        `[${timestamp}] [DEBUG] ${target.name} still DOWN (${state.consecutiveFailures} consecutive failures)`
      );
    }
    // If failures < threshold and not already down → silent (no false alarms)
  }
}
