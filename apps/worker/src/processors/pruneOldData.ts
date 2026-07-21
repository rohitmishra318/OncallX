import type { Job } from 'bullmq';
import { prisma } from '@oncallx/shared';
import type { PruneJobData } from '@oncallx/shared';

const RAW_RETENTION_DAYS = 7;
const HOURLY_RETENTION_DAYS = 90;

/**
 * Daily Pruning Processor
 *
 * Runs once per day (cron: 0 0 * * *). Deletes:
 *  - CheckResult rows older than 7 days (safety net — rollup job should have already deleted them)
 *  - CheckResultHourly rows older than 90 days
 *
 * Neither table grows unbounded.
 */
export async function handlePruneOldData(job: Job<PruneJobData>): Promise<void> {
  console.log('[retention] Starting daily prune job...');

  const rawCutoff = new Date();
  rawCutoff.setDate(rawCutoff.getDate() - RAW_RETENTION_DAYS);

  const hourlyCutoff = new Date();
  hourlyCutoff.setDate(hourlyCutoff.getDate() - HOURLY_RETENTION_DAYS);

  const deletedRaw = await prisma.checkResult.deleteMany({
    where: { timestamp: { lt: rawCutoff } },
  });

  const deletedHourly = await prisma.checkResultHourly.deleteMany({
    where: { hourBucket: { lt: hourlyCutoff } },
  });

  console.log(
    `[retention] Pruned ${deletedRaw.count} CheckResult rows older than ${RAW_RETENTION_DAYS} days, ` +
      `${deletedHourly.count} CheckResultHourly rows older than ${HOURLY_RETENTION_DAYS} days.`
  );
}
