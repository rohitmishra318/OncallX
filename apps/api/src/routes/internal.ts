/**
 * §17.3 — Internal endpoints consumed exclusively by apps/monitor.
 * All routes here require the INTERNAL_MONITOR_KEY shared secret.
 *
 * POST /internal/check-results  — log every check result (like §16.3 but keyed by MonitorTarget.id)
 * POST /internal/target-alert   — report a threshold-crossing failure or recovery;
 *                                  server resolves targetId → serviceId and runs the
 *                                  existing Section 6 dedup/escalation pipeline.
 */
import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import { z } from 'zod';
import { prisma, redis, escalationQueue, notificationQueue, DEDUP_KEY_PREFIX } from '@oncallx/shared';
import type { EscalateCheckJobData, SendNotificationJobData } from '@oncallx/shared';
import { requireInternalKey } from '../middleware/internalKey';
import { emitToTeam } from '../socket';

export const internalRouter = Router();

// Apply internal-key auth to every route on this router
internalRouter.use(requireInternalKey);

// ─── POST /internal/check-results ────────────────────────────────────────────
const checkResultSchema = z.object({
  targetId: z.string().uuid(),
  success: z.boolean(),
  statusCode: z.number().int().nullable().optional(),
  latencyMs: z.number().int().nullable().optional(),
});

internalRouter.post(
  '/check-results',
  async (req: Request, res: Response): Promise<void> => {
    const parsed = checkResultSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }
    const { targetId, success, statusCode, latencyMs } = parsed.data;

    // Verify the target exists (firewall against stale/fake targetIds)
    const target = await prisma.monitorTarget.findUnique({ where: { id: targetId } });
    if (!target) {
      res.status(404).json({ error: 'MonitorTarget not found' });
      return;
    }

    await prisma.checkResult.create({
      data: {
        targetId: target.name, // CheckResult.targetId = human-readable name for the dashboard
        success,
        statusCode,
        latencyMs,
      },
    });

    res.status(201).json({ ok: true });
  }
);

// ─── POST /internal/target-alert ─────────────────────────────────────────────
const targetAlertSchema = z.object({
  targetId: z.string().uuid(),
  // "down" = threshold-crossing failure → fire alert
  // "up"   = recovery after being down → auto-resolve
  event: z.enum(['down', 'up']),
  consecutiveFailures: z.number().int().optional(),
});

internalRouter.post(
  '/target-alert',
  async (req: Request, res: Response): Promise<void> => {
    const parsed = targetAlertSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }
    const { targetId, event, consecutiveFailures } = parsed.data;

    // Resolve MonitorTarget → Service
    const target = await prisma.monitorTarget.findUnique({
      where: { id: targetId },
      include: { service: { include: { team: true } } },
    });

    if (!target) {
      res.status(404).json({ error: 'MonitorTarget not found' });
      return;
    }

    const service = target.service;
    const team = service.team;
    const dedupKey = target.name; // same string used for MaintenanceWindow lookups

    if (event === 'down') {
      // ── Threshold-crossing failure → run Section 6 dedup/escalation pipeline ──
      const policy = await prisma.escalationPolicy.findUnique({
        where: { serviceId: service.id },
      });

      if (!policy) {
        // Service has no escalation policy — log and skip; don't 500
        console.warn(
          `[internal] MonitorTarget "${target.name}" (${targetId}) has no escalation policy on service ${service.id} — skipping alert`
        );
        res.status(200).json({ message: 'No escalation policy configured for this service' });
        return;
      }

      // §16.7 — Suppress if under maintenance
      const now = new Date();
      const activeMaintenance = await prisma.maintenanceWindow.findFirst({
        where: { targetId: dedupKey, startsAt: { lte: now }, endsAt: { gt: now } },
      });
      if (activeMaintenance) {
        res.status(200).json({ message: 'Suppressed — active maintenance window' });
        return;
      }

      // Dedup: is there already an open/acked incident?
      const existingIncident = await prisma.incident.findFirst({
        where: { serviceId: service.id, dedupKey, status: { in: ['OPEN', 'ACKED'] } },
      });
      if (existingIncident) {
        await prisma.incidentEvent.create({
          data: {
            incidentId: existingIncident.id,
            eventType: 'duplicate_alert',
            metadata: { source: 'monitor-internal', targetId },
          },
        });
        res.status(200).json({ message: 'Duplicate — existing incident updated', incidentId: existingIncident.id });
        return;
      }

      // Redis SET NX guard against concurrent races
      const dedupTtlSeconds = policy.escalateAfterMin * 2 * 60;
      const redisKey = `${DEDUP_KEY_PREFIX}${service.id}:${dedupKey}`;
      const newIncidentId = crypto.randomUUID();
      const acquired = await redis.set(redisKey, newIncidentId, 'EX', dedupTtlSeconds, 'NX');
      if (!acquired) {
        res.status(200).json({ message: 'Duplicate alert (concurrent race)' });
        return;
      }

      // Create incident
      const incident = await prisma.incident.create({
        data: {
          id: newIncidentId,
          serviceId: service.id,
          dedupKey,
          severity: 'HIGH',
          title: `${target.name} failed health check${consecutiveFailures != null ? ` ${consecutiveFailures} consecutive time(s)` : ''}`,
          status: 'OPEN',
        },
      });

      await prisma.incidentEvent.create({
        data: {
          incidentId: incident.id,
          eventType: 'created',
          metadata: { source: 'monitor-internal', targetId, consecutiveFailures },
        },
      });

      // Enqueue escalation check
      const delayMs = policy.escalateAfterMin * 60 * 1000;
      await escalationQueue.add(
        'escalate-check',
        { incidentId: incident.id, serviceId: service.id } satisfies EscalateCheckJobData,
        { delay: delayMs, jobId: `escalate-${incident.id}` }
      );

      // Enqueue notifications
      const channels: string[] = ['email'];
      if (team.slackWebhookUrl) channels.push('slack');

      for (const channel of channels) {
        const notification = await prisma.notification.create({
          data: { incidentId: incident.id, channel, status: 'pending' },
        });
        await notificationQueue.add(
          'send-notification',
          {
            incidentId: incident.id,
            notificationId: notification.id,
            channel,
            userId: policy.primaryUserId,
            teamId: team.id,
          } satisfies SendNotificationJobData,
          { jobId: `notify-${notification.id}` }
        );
      }

      emitToTeam(team.id, 'incident:created', { incident, serviceName: service.name });
      res.status(201).json({ incidentId: incident.id });

    } else {
      // ── Recovery → auto-resolve open incident ─────────────────────────────
      const incident = await prisma.incident.findFirst({
        where: { serviceId: service.id, dedupKey, status: { in: ['OPEN', 'ACKED'] } },
      });

      if (!incident) {
        res.status(200).json({ message: 'No open incident to resolve' });
        return;
      }

      const updated = await prisma.incident.update({
        where: { id: incident.id },
        data: { status: 'RESOLVED', resolvedAt: new Date() },
      });

      await prisma.incidentEvent.create({
        data: {
          incidentId: incident.id,
          eventType: 'resolved',
          metadata: { source: 'monitor-internal-auto-resolve', targetId },
        },
      });

      const redisKey = `${DEDUP_KEY_PREFIX}${service.id}:${dedupKey}`;
      await redis.del(redisKey);

      emitToTeam(team.id, 'incident:updated', { incident: updated });
      res.json({ message: 'Incident auto-resolved', incidentId: incident.id });
    }
  }
);
