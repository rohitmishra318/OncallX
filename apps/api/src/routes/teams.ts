import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '@oncallx/shared';
import { requireAuth, requireRole } from '../middleware/auth';

export const teamsRouter = Router();

teamsRouter.use(requireAuth);

// PUT /teams/:id/slack-webhook — ADMIN only
const slackWebhookSchema = z.object({
  slackWebhookUrl: z.string().url().startsWith('https://hooks.slack.com/'),
});

teamsRouter.put(
  '/:id/slack-webhook',
  requireRole('ADMIN'),
  async (req: Request, res: Response): Promise<void> => {
    if (req.params.id !== req.user!.teamId) {
      res.status(403).json({ error: 'Can only update your own team' });
      return;
    }

    const parsed = slackWebhookSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }

    const team = await prisma.team.update({
      where: { id: req.params.id },
      data: { slackWebhookUrl: parsed.data.slackWebhookUrl },
    });

    res.json(team);
  }
);

// GET /teams/:id/users — any authenticated user (own team only)
teamsRouter.get('/:id/users', async (req: Request, res: Response): Promise<void> => {
  if (req.params.id !== req.user!.teamId) {
    res.status(403).json({ error: 'Access denied' });
    return;
  }

  const users = await prisma.user.findMany({
    where: { teamId: req.params.id },
    select: { id: true, email: true, name: true, role: true, createdAt: true },
  });

  res.json(users);
});

// GET /teams/:id/services — any authenticated user (own team only)
// Used by the MonitoringDashboard target-creation form to populate the service selector.
teamsRouter.get('/:id/services', async (req: Request, res: Response): Promise<void> => {
  if (req.params.id !== req.user!.teamId) {
    res.status(403).json({ error: 'Access denied' });
    return;
  }

  const services = await prisma.service.findMany({
    where: { teamId: req.params.id },
    select: { id: true, name: true },
    orderBy: { name: 'asc' },
  });

  res.json(services);
});

