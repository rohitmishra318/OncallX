import { Worker } from 'bullmq';
import { redis, QUEUE_NAMES } from '@oncallx/shared';
import { handleEscalateCheck } from './processors/escalateCheck';
import { handleSendNotification } from './processors/sendNotification';

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

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('[worker] SIGTERM received, shutting down...');
  await escalationWorker.close();
  await notificationWorker.close();
  process.exit(0);
});
