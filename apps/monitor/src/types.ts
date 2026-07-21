/**
 * Shape of an active MonitorTarget as returned by GET /monitoring/targets/active.
 * Mirrors the Prisma MonitorTarget model fields that apps/monitor needs.
 */
export interface ActiveTarget {
  id: string;
  name: string;
  url: string;
  serviceId: string;
  expectedStatus: number;
  timeoutMs: number;
  intervalMs: number;
  failureThreshold: number;
  successThreshold: number;
  degradedLatencyMs: number;
}

/** Per-target runtime state — held in memory only, never persisted */
export interface TargetState {
  consecutiveFailures: number;
  consecutiveSuccesses: number;
  /** Whether the target is currently considered "down" (alert already fired) */
  isDown: boolean;
  /** ISO date string (YYYY-MM-DD) of the last SSL expiry alert, to rate-limit to once/day */
  lastSslAlertDate: string | null;
}

export interface CheckResult {
  success: boolean;
  statusCode: number | null;
  latencyMs: number;
  error?: string;
}

/** Entry in the in-memory job map maintained by index.ts */
export interface JobEntry {
  target: ActiveTarget;
  state: TargetState;
  intervalHandle: ReturnType<typeof setInterval>;
}
