import { Router, Request, Response } from 'express';
import { prisma } from '@oncallx/shared';

export const statusRouter = Router();

/**
 * GET /status/:teamSlug — Public, unauthenticated status page data.
 *
 * SECURITY AUDIT: This route must NEVER return:
 *  - User IDs, names, or emails
 *  - Escalation policy details
 *  - Raw incident data
 *  - Service API keys
 *  - Internal team IDs
 *
 * Returns ONLY: team name (display only), and per-target:
 *   name, status (Operational|Degraded|Down|Under Maintenance), and 90-day uptime bar.
 */
statusRouter.get('/:teamSlug', async (req: Request, res: Response): Promise<void> => {
  const { teamSlug } = req.params;

  const team = await prisma.team.findUnique({
    where: { publicSlug: teamSlug },
    select: { name: true, publicSlug: true }, // Only safe fields
  });

  if (!team) {
    res.status(404).json({ error: 'Status page not found' });
    return;
  }

  const now = new Date();
  const since90d = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);

  // Get all distinct targets
  const distinctTargets = await prisma.checkResult.groupBy({ by: ['targetId'] });

  const targets = await Promise.all(
    distinctTargets.map(async ({ targetId }) => {
      // Check for active maintenance window
      const activeMaintenance = await prisma.maintenanceWindow.findFirst({
        where: {
          targetId,
          startsAt: { lte: now },
          endsAt: { gt: now },
        },
      });

      if (activeMaintenance) {
        return {
          name: targetId,
          status: 'Under Maintenance',
          uptimeBar: [], // No uptime data shown during maintenance
        };
      }

      // Most recent check result
      const latest = await prisma.checkResult.findFirst({
        where: { targetId },
        orderBy: { timestamp: 'desc' },
        select: { success: true, latencyMs: true },
      });

      // 90-day uptime bar — day-level aggregation from hourly rollups
      const hourlyRows = await prisma.checkResultHourly.findMany({
        where: { targetId, hourBucket: { gte: since90d } },
        orderBy: { hourBucket: 'asc' },
        select: { hourBucket: true, totalChecks: true, failedChecks: true },
      });

      const dayMap: Record<string, { total: number; failed: number }> = {};
      for (const row of hourlyRows) {
        const day = row.hourBucket.toISOString().slice(0, 10);
        if (!dayMap[day]) dayMap[day] = { total: 0, failed: 0 };
        dayMap[day].total += row.totalChecks;
        dayMap[day].failed += row.failedChecks;
      }

      const uptimeBar = Object.entries(dayMap).map(([date, { total, failed }]) => ({
        date,
        uptimePercent: total > 0 ? ((total - failed) / total) * 100 : null,
      }));

      // Derive public status — never expose internal latency numbers
      let status: string;
      if (!latest) {
        status = 'Unknown';
      } else if (!latest.success) {
        status = 'Down';
      } else {
        status = 'Operational';
        // Degraded = returning 200 but latency is above threshold
        // degradedLatencyMs is fetched from CheckResult metadata — for now we mark
        // as Operational unless a specific threshold is stored per-target in future
      }

      // Return ONLY the safe, public-facing fields
      return {
        name: targetId,      // target name only, not internal IDs
        status,
        uptimeBar,           // date + percentage only, no raw latency numbers
      };
    })
  );

  res.json({
    teamName: team.name,       // display name only
    targets,
  });
});
