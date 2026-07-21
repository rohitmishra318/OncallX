import { Worker, Queue } from 'bullmq';
import { redis, QUEUE_NAMES } from '@oncallx/shared';
import { handleEscalateCheck } from './processors/escalateCheck';
import { handleSendNotification } from './processors/sendNotification';
import { handleHourlyRollup } from './processors/hourlyRollup';
import { handlePruneOldData } from './processors/pruneOldData';

console.log('[worker] Starting BullMQ worker...');

// Escalation check worker — processes delayed jobs that check if incident is still OPEN
const escalationWorker = new Worker(
  QUEUE_NAMES.ESCALATION,
  handleEscalateCheck,
  { connection: redis as any }
);

// Notification dispatch worker — sends email or Slack per independent job
const notificationWorker = new Worker(
  QUEUE_NAMES.NOTIFICATION,
  handleSendNotification,
  {
    connection: redis as any,
    // Allow up to 3 concurrent notification jobs
    concurrency: 3,
  }
);

// Retention worker — hourly rollup + daily pruning
const retentionWorker = new Worker(
  QUEUE_NAMES.RETENTION,
  async (job) => {
    if (job.name === 'hourly-rollup') return handleHourlyRollup(job as any);
    if (job.name === 'prune-old-data') return handlePruneOldData(job as any);
    console.warn(`[retention] Unknown job name: ${job.name}`);
  },
  { connection: redis as any }
);

escalationWorker.on('completed', (job) => {
  console.log(`[escalation] Job ${job.id} completed`);
});
escalationWorker.on('failed', (job, err) => {
  console.error(`[escalation] Job ${job?.id} failed:`, err.message);
});

notificationWorker.on('completed', (job) => {
  console.log(`[notification] Job ${job.id} completed`);
});
notificationWorker.on('failed', (job, err) => {
  console.error(`[notification] Job ${job?.id} failed:`, err.message);
});

retentionWorker.on('completed', (job) => {
  console.log(`[retention] Job ${job.id} (${job.name}) completed`);
});
retentionWorker.on('failed', (job, err) => {
  console.error(`[retention] Job ${job?.id} (${job?.name}) failed:`, err.message);
});

// Register repeatable jobs on startup (idempotent — BullMQ deduplicates by key)
async function registerRepeatableJobs() {
  const retentionQueue = new Queue(QUEUE_NAMES.RETENTION, { connection: redis as any });

  await retentionQueue.upsertJobScheduler(
    'hourly-rollup',
    { pattern: '0 * * * *' }, // Every hour at :00
    { name: 'hourly-rollup', data: { type: 'hourly-rollup' } }
  );

  await retentionQueue.upsertJobScheduler(
    'prune-old-data',
    { pattern: '0 0 * * *' }, // Every day at midnight
    { name: 'prune-old-data', data: { type: 'prune-old-data' } }
  );

  console.log('[worker] Repeatable jobs registered: hourly-rollup, prune-old-data');
  await retentionQueue.close();
}

registerRepeatableJobs().catch((err) => {
  console.error('[worker] Failed to register repeatable jobs:', err);
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('[worker] SIGTERM received, shutting down...');
  await escalationWorker.close();
  await notificationWorker.close();
  await retentionWorker.close();
  process.exit(0);
});
