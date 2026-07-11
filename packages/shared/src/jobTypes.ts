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
