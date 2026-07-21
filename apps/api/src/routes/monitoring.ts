import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import bcrypt from 'bcrypt';
import { z } from 'zod';
import { prisma, isUrlSafeToFetch } from '@oncallx/shared';
import { requireApiKey } from '../middleware/apiKey';
import { requireAuth, requireRole } from '../middleware/auth';
import { requireInternalKey } from '../middleware/internalKey';

export const monitoringRouter = Router();

// ─── POST /monitoring/check-results (API-key auth — legacy, apps/monitor Phase 16) ──
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

// ─── GET /monitoring/targets (JWT auth — monitoring dashboard read) ───────────
monitoringRouter.get(
  '/targets',
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    const now = new Date();
    const since24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const since7d = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const since30d = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const since90d = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);

    const distinctTargets = await prisma.checkResult.groupBy({
      by: ['targetId'],
    });

    const targets = await Promise.all(
      distinctTargets.map(async ({ targetId }) => {
        const latest = await prisma.checkResult.findFirst({
          where: { targetId },
          orderBy: { timestamp: 'desc' },
        });

        const computeUptime = async (since: Date) => {
          const rows = await prisma.checkResultHourly.findMany({
            where: { targetId, hourBucket: { gte: since } },
          });
          if (rows.length === 0) return null;
          const total = rows.reduce((s, r) => s + r.totalChecks, 0);
          const failed = rows.reduce((s, r) => s + r.failedChecks, 0);
          return total > 0 ? ((total - failed) / total) * 100 : null;
        };

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

// ─── GET /monitoring/targets/:targetId/history (JWT auth) ─────────────────────
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
      default:
        since = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    }

    if (range === '24h') {
      const rows = await prisma.checkResult.findMany({
        where: { targetId, timestamp: { gte: since } },
        orderBy: { timestamp: 'asc' },
        select: { timestamp: true, success: true, latencyMs: true, statusCode: true },
      });
      res.json({ range, resolution: 'raw', data: rows });
    } else {
      const rows = await prisma.checkResultHourly.findMany({
        where: { targetId, hourBucket: { gte: since } },
        orderBy: { hourBucket: 'asc' },
        select: {
          hourBucket: true,
          uptimePercent: true,
          avgLatencyMs: true,
          p95LatencyMs: true,
          totalChecks: true,
          failedChecks: true,
        },
      });
      res.json({ range, resolution: 'hourly', data: rows });
    }
  }
);

// ─── Maintenance Windows (JWT + ADMIN) ────────────────────────────────────────
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

// ─────────────────────────────────────────────────────────────────────────────
// Phase 3: User-managed MonitorTarget CRUD
// ─────────────────────────────────────────────────────────────────────────────

const MAX_TARGETS_PER_USER = parseInt(process.env.MAX_TARGETS_PER_USER ?? '5', 10);
const MIN_INTERVAL_MS = 30_000;
const MAX_TIMEOUT_MS = 10_000;
const BCRYPT_ROUNDS = 10;

const createTargetSchema = z.object({
  name: z.string().min(1).max(100),
  url: z.string().url(),
  serviceId: z.string().uuid(),
  expectedStatus: z.number().int().min(100).max(599).default(200),
  timeoutMs: z.number().int().min(1000).max(MAX_TIMEOUT_MS).default(5000),
  intervalMs: z.number().int().min(MIN_INTERVAL_MS).default(60_000),
  failureThreshold: z.number().int().min(1).max(20).default(3),
  successThreshold: z.number().int().min(1).max(20).default(2),
  degradedLatencyMs: z.number().int().min(100).default(2000),
});

// POST /monitoring/user-targets — create a new monitored target for the current user
monitoringRouter.post(
  '/user-targets',
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    const parsed = createTargetSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }

    const {
      name,
      url,
      serviceId,
      expectedStatus,
      timeoutMs,
      intervalMs,
      failureThreshold,
      successThreshold,
      degradedLatencyMs,
    } = parsed.data;
    const userId = req.user!.userId;
    const teamId = req.user!.teamId;

    // §17.6 — Enforce max-targets limit
    const existing = await prisma.monitorTarget.count({ where: { userId } });
    if (existing >= MAX_TARGETS_PER_USER) {
      res.status(422).json({
        error: `Target limit reached (max ${MAX_TARGETS_PER_USER} per user). Deactivate or delete an existing target first.`,
      });
      return;
    }

    // Verify the referenced service belongs to the user's team
    const service = await prisma.service.findUnique({ where: { id: serviceId } });
    if (!service || service.teamId !== teamId) {
      res.status(404).json({ error: 'Service not found or does not belong to your team' });
      return;
    }

    // §17.4 — SSRF check at creation time
    const safe = await isUrlSafeToFetch(url);
    if (!safe) {
      res.status(422).json({
        error:
          'URL failed security validation. Only public HTTPS URLs are allowed. Private IPs, loopback addresses, and metadata endpoints are blocked.',
      });
      return;
    }

    // Generate the raw API key — shown once, then only the hash is stored
    const rawKey = crypto.randomBytes(32).toString('hex');
    const apiKeyHash = await bcrypt.hash(rawKey, BCRYPT_ROUNDS);

    const target = await prisma.monitorTarget.create({
      data: {
        userId,
        serviceId,
        name,
        url,
        expectedStatus,
        timeoutMs,
        intervalMs,
        failureThreshold,
        successThreshold,
        degradedLatencyMs,
        apiKeyHash,
        isActive: true,
      },
    });

    // Return the raw key exactly once — it is never retrievable again
    res.status(201).json({
      target: {
        id: target.id,
        name: target.name,
        url: target.url,
        serviceId: target.serviceId,
        isActive: target.isActive,
        createdAt: target.createdAt,
      },
      // ⚠️  This is the ONLY time this key will be shown.
      apiKey: rawKey,
    });
  }
);

// GET /monitoring/user-targets — list the current user's own targets (no apiKeyHash)
monitoringRouter.get(
  '/user-targets',
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    const userId = req.user!.userId;
    const targets = await prisma.monitorTarget.findMany({
      where: { userId },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        name: true,
        url: true,
        serviceId: true,
        expectedStatus: true,
        timeoutMs: true,
        intervalMs: true,
        failureThreshold: true,
        successThreshold: true,
        degradedLatencyMs: true,
        isActive: true,
        createdAt: true,
        // apiKeyHash is deliberately excluded
      },
    });
    res.json({ targets });
  }
);

// PATCH /monitoring/user-targets/:id — update config or toggle isActive (owner only)
const patchTargetSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  expectedStatus: z.number().int().min(100).max(599).optional(),
  timeoutMs: z.number().int().min(1000).max(MAX_TIMEOUT_MS).optional(),
  intervalMs: z.number().int().min(MIN_INTERVAL_MS).optional(),
  failureThreshold: z.number().int().min(1).max(20).optional(),
  successThreshold: z.number().int().min(1).max(20).optional(),
  degradedLatencyMs: z.number().int().min(100).optional(),
  isActive: z.boolean().optional(),
});

monitoringRouter.patch(
  '/user-targets/:id',
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    const userId = req.user!.userId;
    const { id } = req.params;

    const target = await prisma.monitorTarget.findUnique({ where: { id } });
    if (!target || target.userId !== userId) {
      res.status(404).json({ error: 'Target not found' });
      return;
    }

    const parsed = patchTargetSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }

    const updated = await prisma.monitorTarget.update({
      where: { id },
      data: parsed.data,
      select: {
        id: true,
        name: true,
        url: true,
        serviceId: true,
        expectedStatus: true,
        timeoutMs: true,
        intervalMs: true,
        failureThreshold: true,
        successThreshold: true,
        degradedLatencyMs: true,
        isActive: true,
        createdAt: true,
      },
    });

    res.json({ target: updated });
  }
);

// DELETE /monitoring/user-targets/:id — delete a target (owner only)
monitoringRouter.delete(
  '/user-targets/:id',
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    const userId = req.user!.userId;
    const { id } = req.params;

    const target = await prisma.monitorTarget.findUnique({ where: { id } });
    if (!target || target.userId !== userId) {
      res.status(404).json({ error: 'Target not found' });
      return;
    }

    await prisma.monitorTarget.delete({ where: { id } });
    res.json({ message: 'Target deleted' });
  }
);

// GET /monitoring/targets/active — INTERNAL_MONITOR_KEY auth only
// Returns the full list of active targets consumed by apps/monitor
monitoringRouter.get(
  '/targets/active',
  requireInternalKey,
  async (_req: Request, res: Response): Promise<void> => {
    const targets = await prisma.monitorTarget.findMany({
      where: { isActive: true },
      select: {
        id: true,
        name: true,
        url: true,
        serviceId: true,
        expectedStatus: true,
        timeoutMs: true,
        intervalMs: true,
        failureThreshold: true,
        successThreshold: true,
        degradedLatencyMs: true,
      },
    });
    res.json({ targets });
  }
);
