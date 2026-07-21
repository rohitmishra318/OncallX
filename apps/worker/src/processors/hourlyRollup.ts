import type { Job } from 'bullmq';
import { prisma } from '@oncallx/shared';
import type { RollupJobData } from '@oncallx/shared';

/**
 * Hourly Rollup Processor
 *
 * Runs once per hour. For each target that has raw CheckResult rows in the
 * COMPLETED previous hour bucket, this job:
 *  1. Loads all CheckResult rows for that hour
 *  2. Excludes rows that fall within an active MaintenanceWindow
 *  3. Aggregates: uptime%, avg latency, p95 latency, total/failed counts
 *  4. Upserts one CheckResultHourly row
 *  5. Deletes the source CheckResult rows (write-first, delete-after — no data loss)
 *
 * Interview answer: raw rows answer "what happened in the last 7 days",
 * rollups answer "what's my 90-day uptime trend", and neither table grows unbounded.
 */
export async function handleHourlyRollup(job: Job<RollupJobData>): Promise<void> {
  console.log('[retention] Starting hourly rollup job...');

  // Compute the completed previous hour bucket
  const now = new Date();
  const hourBucket = new Date(now);
  hourBucket.setMinutes(0, 0, 0);
  hourBucket.setHours(hourBucket.getHours() - 1);

  const hourEnd = new Date(hourBucket);
  hourEnd.setHours(hourEnd.getHours() + 1);

  console.log(`[retention] Rolling up hour: ${hourBucket.toISOString()} → ${hourEnd.toISOString()}`);

  // Find all distinct targetIds with raw rows in this hour
  const distinctTargets = await prisma.checkResult.groupBy({
    by: ['targetId'],
    where: {
      timestamp: { gte: hourBucket, lt: hourEnd },
    },
  });

  if (distinctTargets.length === 0) {
    console.log('[retention] No CheckResult rows found for this hour — skipping.');
    return;
  }

  for (const { targetId } of distinctTargets) {
    // Load all raw rows for this target/hour
    const rawRows = await prisma.checkResult.findMany({
      where: { targetId, timestamp: { gte: hourBucket, lt: hourEnd } },
      orderBy: { timestamp: 'asc' },
    });

    // Find MaintenanceWindows that overlap this hour for this target
    const windows = await prisma.maintenanceWindow.findMany({
      where: {
        targetId,
        startsAt: { lt: hourEnd },
        endsAt: { gt: hourBucket },
      },
    });

    // Exclude rows that fall within any maintenance window
    const billableRows = rawRows.filter((row) => {
      return !windows.some((w) => row.timestamp >= w.startsAt && row.timestamp < w.endsAt);
    });

    if (billableRows.length === 0) {
      // Entire hour was under maintenance — still delete the raw rows
      await prisma.checkResult.deleteMany({
        where: { targetId, timestamp: { gte: hourBucket, lt: hourEnd } },
      });
      console.log(`[retention] ${targetId}: entire hour under maintenance, no rollup written.`);
      continue;
    }

    // Aggregate stats from billable rows only
    const totalChecks = billableRows.length;
    const failedChecks = billableRows.filter((r) => !r.success).length;
    const uptimePercent = ((totalChecks - failedChecks) / totalChecks) * 100;

    const latencies = billableRows
      .map((r) => r.latencyMs ?? 0)
      .sort((a, b) => a - b);

    const avgLatencyMs = latencies.reduce((sum, v) => sum + v, 0) / latencies.length;
    const p95Index = Math.floor(latencies.length * 0.95);
    const p95LatencyMs = latencies[Math.min(p95Index, latencies.length - 1)];

    // Upsert the rollup row
    await prisma.checkResultHourly.upsert({
      where: { targetId_hourBucket: { targetId, hourBucket } },
      create: {
        targetId,
        hourBucket,
        uptimePercent,
        avgLatencyMs,
        p95LatencyMs,
        totalChecks,
        failedChecks,
      },
      update: {
        uptimePercent,
        avgLatencyMs,
        p95LatencyMs,
        totalChecks,
        failedChecks,
      },
    });

    // Safe to delete source rows now — rollup is committed
    await prisma.checkResult.deleteMany({
      where: { targetId, timestamp: { gte: hourBucket, lt: hourEnd } },
    });

    console.log(
      `[retention] ${targetId}: rolled up ${totalChecks} checks → ` +
        `${uptimePercent.toFixed(1)}% uptime, avg ${avgLatencyMs.toFixed(0)}ms, p95 ${p95LatencyMs}ms`
    );
  }

  console.log(`[retention] Hourly rollup complete — processed ${distinctTargets.length} target(s).`);
}
