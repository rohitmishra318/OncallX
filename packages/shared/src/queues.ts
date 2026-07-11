import { Queue } from 'bullmq';
import { redis } from './redisClient';

export const QUEUE_NAMES = {
  ESCALATION: 'escalation',
  NOTIFICATION: 'notification',
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
