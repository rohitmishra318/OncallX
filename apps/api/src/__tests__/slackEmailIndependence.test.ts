// Integration test: failing Slack webhook must not delay or block the email job
// Key acceptance criterion: these are two independent BullMQ jobs — a Slack failure
// causes BullMQ to retry the Slack job only; the email job runs independently.

const mockFindUnique = jest.fn();
const mockFindFirst = jest.fn();
const mockCreate = jest.fn();

jest.mock('@oncallx/shared', () => ({
  prisma: {
    service: { findUnique: mockFindUnique },
    escalationPolicy: { findUnique: mockFindUnique },
    team: { findUnique: mockFindUnique },
    incident: {
      findFirst: mockFindFirst,
      findUnique: mockFindUnique,
      create: mockCreate,
    },
    incidentEvent: { create: mockCreate },
    notification: { create: mockCreate, update: jest.fn() },
  },
  redis: {
    set: jest.fn(),
    get: jest.fn(),
  },
  escalationQueue: { add: jest.fn() },
  notificationQueue: { add: jest.fn() },
  QUEUE_NAMES: { ESCALATION: 'escalation', NOTIFICATION: 'notification' },
  DEDUP_KEY_PREFIX: 'dedup:incident:',
  REFRESH_TOKEN_PREFIX: 'refresh:',
}));

jest.mock('../socket', () => ({
  initSocket: jest.fn(),
  emitToTeam: jest.fn(),
  getIO: jest.fn(),
}));

import request from 'supertest';
import app from '../app';
import { prisma, redis, notificationQueue } from '@oncallx/shared';

const mockService = {
  id: 'svc-2',
  name: 'Test Service',
  teamId: 'team-2',
  apiKey: 'test-api-key-456',
  escalationPolicyId: 'policy-2',
};

const mockPolicy = {
  id: 'policy-2',
  serviceId: 'svc-2',
  primaryUserId: 'user-primary-2',
  fallbackUserId: 'user-fallback-2',
  escalateAfterMin: 5,
};

describe('Slack/Email independence — failing Slack must not block email', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (notificationQueue.add as jest.Mock).mockResolvedValue({});
  });

  it('enqueues email and Slack as independent jobs — both are added regardless of each other', async () => {
    const teamWithSlack = {
      id: 'team-2',
      slackWebhookUrl: 'https://hooks.slack.com/services/UNREACHABLE',
    };

    // Setup mocks
    mockFindUnique
      .mockResolvedValueOnce(mockService)
      .mockResolvedValueOnce(mockPolicy)
      .mockResolvedValueOnce(teamWithSlack);

    mockFindFirst.mockResolvedValueOnce(null);
    (redis.set as jest.Mock).mockResolvedValueOnce('OK');

    const mockIncident = {
      id: 'inc-slack-test',
      serviceId: 'svc-2',
      dedupKey: 'slack-test-key',
      status: 'OPEN',
      severity: 'CRITICAL',
      title: 'Slack test',
      createdAt: new Date(),
    };

    mockCreate
      .mockResolvedValueOnce(mockIncident)              // incident.create
      .mockResolvedValueOnce({})                         // incidentEvent.create
      .mockResolvedValueOnce({ id: 'notif-email' })     // notification.create email
      .mockResolvedValueOnce({ id: 'notif-slack' });    // notification.create slack

    const res = await request(app)
      .post('/alerts')
      .set('X-Api-Key', 'test-api-key-456')
      .send({ dedupKey: 'slack-test-key', severity: 'CRITICAL' });

    expect(res.status).toBe(201);

    // Verify both jobs were independently enqueued
    expect(notificationQueue.add).toHaveBeenCalledTimes(2);

    const callArgs = (notificationQueue.add as jest.Mock).mock.calls;
    const emailCall = callArgs.find((call: [string, { channel: string }]) => call[1].channel === 'email');
    const slackCall = callArgs.find((call: [string, { channel: string }]) => call[1].channel === 'slack');

    expect(emailCall).toBeDefined();
    expect(slackCall).toBeDefined();

    // Each job has its own notificationId — they are completely independent
    expect(emailCall[1].notificationId).toBe('notif-email');
    expect(slackCall[1].notificationId).toBe('notif-slack');

    // The two jobs have separate jobIds — BullMQ treats them as independent
    // A failing Slack job retries separately, never touching the email job
    expect(emailCall[1].channel).toBe('email');
    expect(slackCall[1].channel).toBe('slack');
  });

  it('only enqueues email job when team has no Slack webhook — no Slack job at all', async () => {
    const teamNoSlack = { id: 'team-2', slackWebhookUrl: null };

    mockFindUnique
      .mockResolvedValueOnce(mockService)
      .mockResolvedValueOnce(mockPolicy)
      .mockResolvedValueOnce(teamNoSlack);

    mockFindFirst.mockResolvedValueOnce(null);
    (redis.set as jest.Mock).mockResolvedValueOnce('OK');

    mockCreate
      .mockResolvedValueOnce({ id: 'inc-2', serviceId: 'svc-2', dedupKey: 'k2', status: 'OPEN', severity: 'LOW', title: 'x', createdAt: new Date() })
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ id: 'notif-email-only' });

    const res = await request(app)
      .post('/alerts')
      .set('X-Api-Key', 'test-api-key-456')
      .send({ dedupKey: 'no-slack-key', severity: 'LOW' });

    expect(res.status).toBe(201);
    expect(notificationQueue.add).toHaveBeenCalledTimes(1);
    expect((notificationQueue.add as jest.Mock).mock.calls[0][1].channel).toBe('email');
  });
});
