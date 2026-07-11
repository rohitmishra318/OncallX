import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import { z } from 'zod';
import { prisma, redis, escalationQueue, notificationQueue } from '@oncallx/shared';
import { DEDUP_KEY_PREFIX } from '@oncallx/shared';
import type { EscalateCheckJobData, SendNotificationJobData } from '@oncallx/shared';
import { requireApiKey } from '../middleware/apiKey';
import { emitToTeam } from '../socket';

export const alertsRouter = Router();

const alertSchema = z.object({
  dedupKey: z.string().min(1).max(255),
  severity: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']),
  title: z.string().min(1).max(500).optional(),
});

// POST /alerts — authenticated via per-service API key
alertsRouter.post('/', requireApiKey, async (req: Request, res: Response): Promise<void> => {
  const parsed = alertSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  const { dedupKey, severity, title } = parsed.data;
  const service = req.service!;

  // Fetch escalation policy to get the TTL and users
  const policy = await prisma.escalationPolicy.findUnique({
    where: { serviceId: service.id },
  });

  if (!policy) {
    res.status(422).json({ error: 'Service has no escalation policy configured' });
    return;
  }

  // Fetch team for Slack webhook check
  const team = await prisma.team.findUnique({ where: { id: service.teamId } });
  if (!team) {
    res.status(404).json({ error: 'Team not found' });
    return;
  }

  // TTL = escalateAfterMin * 2 (in seconds), as spec'd
  const dedupTtlSeconds = policy.escalateAfterMin * 2 * 60;
  const redisKey = `${DEDUP_KEY_PREFIX}${service.id}:${dedupKey}`;

  // Atomic dedup check + incident creation guard using SET NX EX
  // This is the race-condition guard: only the first concurrent request with the same
  // dedupKey will get "OK" from Redis; all others get null → treated as duplicate.
  const incident = await prisma.incident.findFirst({
    where: { serviceId: service.id, dedupKey, status: { in: ['OPEN', 'ACKED'] } },
  });

  if (incident) {
    // Duplicate — append event and return 200
    await prisma.incidentEvent.create({
      data: {
        incidentId: incident.id,
        eventType: 'duplicate_alert',
        metadata: { dedupKey, severity },
      },
    });
    res.status(200).json({ message: 'Duplicate alert — existing incident updated', incidentId: incident.id });
    return;
  }

  // Attempt atomic Redis SET NX EX to guard against race conditions
  const newIncidentId = crypto.randomUUID();
  const acquired = await redis.set(redisKey, newIncidentId, 'EX', dedupTtlSeconds, 'NX');
  if (!acquired) {
    // Lost the race — another concurrent request is creating the incident right now
    res.status(200).json({ message: 'Duplicate alert (concurrent)' });
    return;
  }

  // Create the incident
  const newIncident = await prisma.incident.create({
    data: {
      id: newIncidentId,
      serviceId: service.id,
      dedupKey,
      severity,
      title: title ?? `Alert: ${dedupKey}`,
      status: 'OPEN',
    },
  });

  // Create initial IncidentEvent
  await prisma.incidentEvent.create({
    data: {
      incidentId: newIncident.id,
      eventType: 'created',
      metadata: { severity, serviceId: service.id, dedupKey },
    },
  });

  // Enqueue delayed escalation-check job
  const delayMs = policy.escalateAfterMin * 60 * 1000;
  await escalationQueue.add(
    'escalate-check',
    { incidentId: newIncident.id, serviceId: service.id } satisfies EscalateCheckJobData,
    { delay: delayMs, jobId: `escalate:${newIncident.id}` }
  );

  // Create Notification records and enqueue send-notification jobs (email always, slack if configured)
  const channels: string[] = ['email'];
  if (team.slackWebhookUrl) channels.push('slack');

  for (const channel of channels) {
    const notification = await prisma.notification.create({
      data: {
        incidentId: newIncident.id,
        channel,
        status: 'pending',
      },
    });

    await notificationQueue.add(
      'send-notification',
      {
        incidentId: newIncident.id,
        notificationId: notification.id,
        channel,
        userId: policy.primaryUserId,
        teamId: team.id,
      } satisfies SendNotificationJobData,
      // Each channel job is independent — no grouping — so a failing Slack job never blocks email
      { jobId: `notify:${notification.id}` }
    );
  }

  // Emit real-time event to team room
  emitToTeam(team.id, 'incident:created', {
    incident: newIncident,
    serviceName: service.name,
  });

  res.status(201).json({ incidentId: newIncident.id });
});
