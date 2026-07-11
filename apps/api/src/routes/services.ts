import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '@oncallx/shared';
import { requireAuth, requireRole } from '../middleware/auth';

export const servicesRouter = Router();

servicesRouter.use(requireAuth);

// POST /services — ADMIN only
const createServiceSchema = z.object({
  name: z.string().min(1),
  teamId: z.string().uuid(),
});

servicesRouter.post(
  '/',
  requireRole('ADMIN'),
  async (req: Request, res: Response): Promise<void> => {
    const parsed = createServiceSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }
    const { name, teamId } = parsed.data;

    if (teamId !== req.user!.teamId) {
      res.status(403).json({ error: 'Can only create services for your own team' });
      return;
    }

    const service = await prisma.service.create({ data: { name, teamId } });
    res.status(201).json(service);
  }
);

// POST /services/:id/escalation-policy — ADMIN only
const escalationPolicySchema = z.object({
  primaryUserId: z.string().uuid(),
  fallbackUserId: z.string().uuid(),
  escalateAfterMin: z.number().int().positive().default(5),
});

servicesRouter.post(
  '/:id/escalation-policy',
  requireRole('ADMIN'),
  async (req: Request, res: Response): Promise<void> => {
    const parsed = escalationPolicySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }

    const service = await prisma.service.findUnique({ where: { id: req.params.id } });
    if (!service) {
      res.status(404).json({ error: 'Service not found' });
      return;
    }
    if (service.teamId !== req.user!.teamId) {
      res.status(403).json({ error: 'Access denied' });
      return;
    }

    const { primaryUserId, fallbackUserId, escalateAfterMin } = parsed.data;

    // Upsert — set or update the policy
    const policy = await prisma.escalationPolicy.upsert({
      where: { serviceId: service.id },
      create: { serviceId: service.id, primaryUserId, fallbackUserId, escalateAfterMin },
      update: { primaryUserId, fallbackUserId, escalateAfterMin },
    });

    // Update the service's escalationPolicyId reference
    await prisma.service.update({
      where: { id: service.id },
      data: { escalationPolicyId: policy.id },
    });

    res.status(201).json(policy);
  }
);
