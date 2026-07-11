import { Job } from 'bullmq';
import { prisma, notificationQueue } from '@oncallx/shared';
import type { EscalateCheckJobData, SendNotificationJobData } from '@oncallx/shared';
import { emitWorkerEvent } from '../socketEmitter';

export async function handleEscalateCheck(job: Job<EscalateCheckJobData>): Promise<void> {
  const { incidentId } = job.data;

  const incident = await prisma.incident.findUnique({ where: { id: incidentId } });
  if (!incident) {
    console.warn(`[escalate-check] Incident ${incidentId} not found, skipping`);
    return;
  }

  // No-op if already acknowledged or resolved — acking stops escalation
  if (incident.status !== 'OPEN') {
    console.log(`[escalate-check] Incident ${incidentId} is ${incident.status}, no escalation needed`);
    return;
  }

  // Fetch escalation policy to get fallback user
  const policy = await prisma.escalationPolicy.findUnique({
    where: { serviceId: incident.serviceId },
  });
  if (!policy) {
    console.warn(`[escalate-check] No policy for service ${incident.serviceId}, skipping escalation`);
    return;
  }

  // Fetch team for Slack webhook check
  const service = await prisma.service.findUnique({ where: { id: incident.serviceId } });
  const team = service ? await prisma.team.findUnique({ where: { id: service.teamId } }) : null;

  // Enqueue notification jobs for fallback user (email always, Slack if configured)
  const channels: string[] = ['email'];
  if (team?.slackWebhookUrl) channels.push('slack');

  for (const channel of channels) {
    const notification = await prisma.notification.create({
      data: { incidentId, channel, status: 'pending' },
    });
    await notificationQueue.add(
      'send-notification',
      {
        incidentId,
        notificationId: notification.id,
        channel,
        userId: policy.fallbackUserId,
        teamId: team?.id ?? '',
      } satisfies SendNotificationJobData,
      { jobId: `notify:escalated:${notification.id}` }
    );
  }

  // Record escalation event
  await prisma.incidentEvent.create({
    data: {
      incidentId,
      eventType: 'escalated',
      metadata: { fallbackUserId: policy.fallbackUserId },
    },
  });

  // Emit WebSocket event so live dashboard updates
  if (team) {
    await emitWorkerEvent(team.id, 'incident:escalated', { incidentId, fallbackUserId: policy.fallbackUserId });
  }

  console.log(`[escalate-check] Incident ${incidentId} escalated to ${policy.fallbackUserId}`);
}
