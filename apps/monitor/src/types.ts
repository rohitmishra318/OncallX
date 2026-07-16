/**
 * Target configuration shape.
 * `apiKeyEnvVar` is the name of the environment variable that holds the
 * OnCallX service API key for this target — never put the key itself here.
 */
export interface TargetConfig {
  /** Unique name used as the OnCallX `dedupKey` */
  name: string;
  /** Full URL of the health-check endpoint */
  url: string;
  /** Expected HTTP status code for a healthy response */
  expectedStatus: number;
  /** Request timeout in milliseconds */
  timeoutMs: number;
  /** How often to poll, in milliseconds */
  intervalMs: number;
  /** How many consecutive failures before firing an alert */
  failureThreshold: number;
  /** How many consecutive successes before auto-resolving */
  successThreshold: number;
  /** Name of the env var that holds the OnCallX service API key */
  apiKeyEnvVar: string;
}

/** Per-target runtime state — held in memory only */
export interface TargetState {
  consecutiveFailures: number;
  consecutiveSuccesses: number;
  /** Whether we are currently in a "down" state (alert already fired) */
  isDown: boolean;
  /** The OnCallX incidentId from the most recent alert (for auto-resolve) */
  openIncidentId: string | null;
}

export interface CheckResult {
  success: boolean;
  statusCode: number | null;
  latencyMs: number;
  error?: string;
}
