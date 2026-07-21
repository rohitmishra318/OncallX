import { Queue } from 'bullmq';
import { redis } from './redisClient';

export const QUEUE_NAMES = {
  ESCALATION: 'escalation',
  NOTIFICATION: 'notification',
  RETENTION: 'retention',
} as const;

// Queue for delayed escalation checks — jobs are delayed by escalateAfterMin
export const escalationQueue = new Queue(QUEUE_NAMES.ESCALATION, {
  connection: redis as any,
});

// Queue for dispatching notifications (email / slack) — two independent jobs per incident
export const notificationQueue = new Queue(QUEUE_NAMES.NOTIFICATION, {
  connection: redis as any,
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 2000,
    },
  },
});
// Queue for repeatable retention jobs — hourly rollup and daily pruning
export const retentionQueue = new Queue(QUEUE_NAMES.RETENTION, {
  connection: redis as any,
});
