import { Router, Request, Response } from 'express';
import { prisma, notificationQueue } from '@oncallx/shared';
import type { SendNotificationJobData } from '@oncallx/shared';
import { requireAuth, requireRole } from '../middleware/auth';
import { emitToTeam } from '../socket';

export const incidentsRouter = Router();

// All incident routes require auth
incidentsRouter.use(requireAuth);

// GET /incidents — list with cursor pagination + status filter
incidentsRouter.get('/', async (req: Request, res: Response): Promise<void> => {
  const { status, cursor, limit = '20' } = req.query as Record<string, string>;
  const take = Math.min(parseInt(limit, 10) || 20, 100);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const where: any = { service: { teamId: req.user!.teamId } };
  if (status) where.status = status.toUpperCase();

  const incidents = await prisma.incident.findMany({
    where,
    take: take + 1, // fetch one extra to determine if there's a next page
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    orderBy: { createdAt: 'desc' },
    include: { events: { orderBy: { createdAt: 'asc' } } },
  });

  const hasNextPage = incidents.length > take;
  const page = incidents.slice(0, take);
  const nextCursor = hasNextPage ? page[page.length - 1].id : null;

  res.json({ incidents: page, nextCursor });
});

// GET /incidents/:id — detail + event history
incidentsRouter.get('/:id', async (req: Request, res: Response): Promise<void> => {
  const incident = await prisma.incident.findUnique({
    where: { id: req.params.id },
    include: {
      events: { orderBy: { createdAt: 'asc' } },
      notifications: true,
    },
  });

  if (!incident) {
    res.status(404).json({ error: 'Incident not found' });
    return;
  }

  // Check team membership
  const service = await prisma.service.findUnique({ where: { id: incident.serviceId } });
  if (service?.teamId !== req.user!.teamId) {
    res.status(403).json({ error: 'Access denied' });
    return;
  }

  res.json(incident);
});

// POST /incidents/:id/ack — RESPONDER or ADMIN
incidentsRouter.post(
  '/:id/ack',
  requireRole('RESPONDER', 'ADMIN'),
  async (req: Request, res: Response): Promise<void> => {
    const incident = await prisma.incident.findUnique({ where: { id: req.params.id } });
    if (!incident) {
      res.status(404).json({ error: 'Incident not found' });
      return;
    }
    if (incident.status !== 'OPEN') {
      res.status(409).json({ error: `Incident is already ${incident.status}` });
      return;
    }

    const service = await prisma.service.findUnique({ where: { id: incident.serviceId } });
    if (service?.teamId !== req.user!.teamId) {
      res.status(403).json({ error: 'Access denied' });
      return;
    }

    const updated = await prisma.incident.update({
      where: { id: incident.id },
      data: { status: 'ACKED', ackedAt: new Date(), ackedById: req.user!.userId },
    });

    await prisma.incidentEvent.create({
      data: { incidentId: incident.id, eventType: 'acked', actorId: req.user!.userId },
    });

    emitToTeam(service!.teamId, 'incident:updated', { incident: updated });

    res.json(updated);
  }
);

// POST /incidents/:id/resolve — RESPONDER or ADMIN
incidentsRouter.post(
  '/:id/resolve',
  requireRole('RESPONDER', 'ADMIN'),
  async (req: Request, res: Response): Promise<void> => {
    const incident = await prisma.incident.findUnique({ where: { id: req.params.id } });
    if (!incident) {
      res.status(404).json({ error: 'Incident not found' });
      return;
    }
    if (incident.status === 'RESOLVED') {
      res.status(409).json({ error: 'Incident is already RESOLVED' });
      return;
    }

    const service = await prisma.service.findUnique({ where: { id: incident.serviceId } });
    if (service?.teamId !== req.user!.teamId) {
      res.status(403).json({ error: 'Access denied' });
      return;
    }

    const updated = await prisma.incident.update({
      where: { id: incident.id },
      data: { status: 'RESOLVED', resolvedAt: new Date() },
    });

    await prisma.incidentEvent.create({
      data: { incidentId: incident.id, eventType: 'resolved', actorId: req.user!.userId },
    });

    // Enqueue a resolve notification to the primary user
    const policy = await prisma.escalationPolicy.findUnique({ where: { serviceId: service!.id } });
    const team = await prisma.team.findUnique({ where: { id: service!.teamId } });

    if (policy && team) {
      const channels: string[] = ['email'];
      if (team.slackWebhookUrl) channels.push('slack');
      for (const channel of channels) {
        const notification = await prisma.notification.create({
          data: { incidentId: incident.id, channel, status: 'pending' },
        });
        await notificationQueue.add('send-notification', {
          incidentId: incident.id,
          notificationId: notification.id,
          channel,
          userId: policy.primaryUserId,
          teamId: team.id,
        } satisfies SendNotificationJobData);
      }
    }

    emitToTeam(service!.teamId, 'incident:updated', { incident: updated });

    res.json(updated);
  }
);
