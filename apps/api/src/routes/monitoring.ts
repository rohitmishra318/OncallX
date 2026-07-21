import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '@oncallx/shared';
import { requireApiKey } from '../middleware/apiKey';
import { requireAuth, requireRole } from '../middleware/auth';

export const monitoringRouter = Router();

// ─── POST /monitoring/check-results (API-key auth — for apps/monitor) ────────
const checkResultSchema = z.object({
  targetId: z.string().min(1).max(255),
  success: z.boolean(),
  statusCode: z.number().int().nullable().optional(),
  latencyMs: z.number().int().nullable().optional(),
});

monitoringRouter.post(
  '/check-results',
  requireApiKey,
  async (req: Request, res: Response): Promise<void> => {
    const parsed = checkResultSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }
    const { targetId, success, statusCode, latencyMs } = parsed.data;

    await prisma.checkResult.create({
      data: { targetId, success, statusCode, latencyMs },
    });

    res.status(201).json({ ok: true });
  }
);

// ─── GET /monitoring/targets (JWT auth — internal dashboard) ──────────────────
monitoringRouter.get(
  '/targets',
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    const now = new Date();
    const since24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const since7d = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const since30d = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const since90d = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);

    // Get all distinct targets that have sent check results to this team's services
    // (targetId is the monitor target name, scoped by service API key)
    const distinctTargets = await prisma.checkResult.groupBy({
      by: ['targetId'],
    });

    const targets = await Promise.all(
      distinctTargets.map(async ({ targetId }) => {
        // Most recent check for current status + latency
        const latest = await prisma.checkResult.findFirst({
          where: { targetId },
          orderBy: { timestamp: 'desc' },
        });

        // Uptime percentages from hourly rollups
        const computeUptime = async (since: Date) => {
          const rows = await prisma.checkResultHourly.findMany({
            where: { targetId, hourBucket: { gte: since } },
          });
          if (rows.length === 0) return null;
          const total = rows.reduce((s, r) => s + r.totalChecks, 0);
          const failed = rows.reduce((s, r) => s + r.failedChecks, 0);
          return total > 0 ? ((total - failed) / total) * 100 : null;
        };

        // 90-day uptime strip: one entry per day
        const uptimeStrip = await prisma.checkResultHourly.groupBy({
          by: ['targetId'],
          where: { targetId, hourBucket: { gte: since90d } },
          // We need day-level grouping — done in application code below
        });

        // Day-level grouping for the strip
        const hourlyRows = await prisma.checkResultHourly.findMany({
          where: { targetId, hourBucket: { gte: since90d } },
          orderBy: { hourBucket: 'asc' },
        });

        const dayMap: Record<string, { total: number; failed: number }> = {};
        for (const row of hourlyRows) {
          const day = row.hourBucket.toISOString().slice(0, 10);
          if (!dayMap[day]) dayMap[day] = { total: 0, failed: 0 };
          dayMap[day].total += row.totalChecks;
          dayMap[day].failed += row.failedChecks;
        }

        const strip = Object.entries(dayMap).map(([date, { total, failed }]) => ({
          date,
          uptimePercent: total > 0 ? ((total - failed) / total) * 100 : null,
        }));

        const [u24h, u7d, u30d, u90d] = await Promise.all([
          computeUptime(since24h),
          computeUptime(since7d),
          computeUptime(since30d),
          computeUptime(since90d),
        ]);

        return {
          targetId,
          status: latest?.success === true ? 'up' : latest?.success === false ? 'down' : 'unknown',
          latencyMs: latest?.latencyMs ?? null,
          lastCheckedAt: latest?.timestamp ?? null,
          uptime: { h24: u24h, d7: u7d, d30: u30d, d90: u90d },
          uptimeStrip: strip,
        };
      })
    );

    res.json({ targets });
  }
);

// ─── GET /monitoring/targets/:targetId/history (JWT auth) ────────────────────
monitoringRouter.get(
  '/targets/:targetId/history',
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    const { targetId } = req.params;
    const range = (req.query.range as string) ?? '24h';

    const now = new Date();
    let since: Date;

    switch (range) {
      case '7d':
        since = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        break;
      case '30d':
        since = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        break;
      case '90d':
        since = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
        break;
      default: // 24h — use raw CheckResult rows at full resolution
        since = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    }

    if (range === '24h') {
      // Raw resolution
      const rows = await prisma.checkResult.findMany({
        where: { targetId, timestamp: { gte: since } },
        orderBy: { timestamp: 'asc' },
        select: { timestamp: true, success: true, latencyMs: true, statusCode: true },
      });
      res.json({ range, resolution: 'raw', data: rows });
    } else {
      // Hourly rollup resolution
      const rows = await prisma.checkResultHourly.findMany({
        where: { targetId, hourBucket: { gte: since } },
        orderBy: { hourBucket: 'asc' },
        select: { hourBucket: true, uptimePercent: true, avgLatencyMs: true, p95LatencyMs: true, totalChecks: true, failedChecks: true },
      });
      res.json({ range, resolution: 'hourly', data: rows });
    }
  }
);

// ─── Maintenance Windows (JWT + ADMIN) ───────────────────────────────────────
const maintenanceSchema = z.object({
  targetId: z.string().min(1),
  startsAt: z.string().datetime(),
  endsAt: z.string().datetime(),
  reason: z.string().optional(),
});

monitoringRouter.post(
  '/maintenance',
  requireAuth,
  requireRole('ADMIN'),
  async (req: Request, res: Response): Promise<void> => {
    const parsed = maintenanceSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }

    const window = await prisma.maintenanceWindow.create({
      data: {
        targetId: parsed.data.targetId,
        startsAt: new Date(parsed.data.startsAt),
        endsAt: new Date(parsed.data.endsAt),
        reason: parsed.data.reason,
        createdById: req.user!.userId,
      },
    });

    res.status(201).json(window);
  }
);

monitoringRouter.get(
  '/maintenance',
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    const now = new Date();
    // Return active + future windows
    const windows = await prisma.maintenanceWindow.findMany({
      where: { endsAt: { gte: now } },
      orderBy: { startsAt: 'asc' },
    });
    res.json({ windows });
  }
);

monitoringRouter.delete(
  '/maintenance/:id',
  requireAuth,
  requireRole('ADMIN'),
  async (req: Request, res: Response): Promise<void> => {
    const existing = await prisma.maintenanceWindow.findUnique({
      where: { id: req.params.id },
    });
    if (!existing) {
      res.status(404).json({ error: 'Maintenance window not found' });
      return;
    }
    await prisma.maintenanceWindow.delete({ where: { id: req.params.id } });
    res.json({ message: 'Maintenance window deleted' });
  }
);
