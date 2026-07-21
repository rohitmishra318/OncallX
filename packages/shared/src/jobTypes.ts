export interface EscalateCheckJobData {
  incidentId: string;
  serviceId: string;
}

export interface SendNotificationJobData {
  incidentId: string;
  notificationId: string;
  channel: string; // "email" | "slack"
  userId: string;
  teamId: string;
}

// Retention job types
export interface RollupJobData {
  // Empty — the job always processes the previously completed hour
  type: 'hourly-rollup';
}

export interface PruneJobData {
  type: 'prune-old-data';
}
