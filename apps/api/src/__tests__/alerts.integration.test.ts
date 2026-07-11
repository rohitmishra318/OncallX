// Integration tests: full alert → incident → ack flow
// Uses Supertest for HTTP + mocks Prisma, Redis, and BullMQ

import request from 'supertest';
import jwt from 'jsonwebtoken';

// --- Mocks must be declared before any module imports that use them ---
const mockFindUnique = jest.fn();
const mockFindFirst = jest.fn();
const mockCreate = jest.fn();
const mockUpdate = jest.fn();

jest.mock('@oncallx/shared', () => ({
  prisma: {
    service: { findUnique: mockFindUnique },
    escalationPolicy: { findUnique: mockFindUnique },
    team: { findUnique: mockFindUnique },
    incident: {
      findFirst: mockFindFirst,
      findUnique: mockFindUnique,
      create: mockCreate,
      update: mockUpdate,
    },
    incidentEvent: { create: mockCreate },
    notification: { create: mockCreate, update: mockUpdate },
    user: { findUnique: mockFindUnique },
  },
  redis: {
    set: jest.fn(),
    get: jest.fn(),
    del: jest.fn(),
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

import app from '../app';
import { prisma, redis, escalationQueue, notificationQueue } from '@oncallx/shared';

const ACCESS_SECRET = process.env.JWT_ACCESS_SECRET ?? 'test_access_secret_32_chars_min!!';

function makeToken(role = 'RESPONDER', teamId = 'team-1') {
  return jwt.sign({ userId: 'user-1', teamId, role }, ACCESS_SECRET, { expiresIn: '15m' });
}

const mockService = {
  id: 'svc-1',
  name: 'Test Service',
  teamId: 'team-1',
  apiKey: 'test-api-key-123',
  escalationPolicyId: 'policy-1',
};

const mockPolicy = {
  id: 'policy-1',
  serviceId: 'svc-1',
  primaryUserId: 'user-primary',
  fallbackUserId: 'user-fallback',
  escalateAfterMin: 5,
};

const mockTeam = {
  id: 'team-1',
  name: 'Test Team',
  slackWebhookUrl: null,
};

const mockIncident = {
  id: 'incident-1',
  serviceId: 'svc-1',
  dedupKey: 'test-dedup-key',
  status: 'OPEN',
  severity: 'HIGH',
  title: 'Alert: test-dedup-key',
  createdAt: new Date(),
  ackedAt: null,
  resolvedAt: null,
};

describe('POST /alerts', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('creates a new incident when no dedup exists (201)', async () => {
    // findUnique is called for: service (apiKey lookup), escalationPolicy, team
    mockFindUnique
      .mockResolvedValueOnce(mockService)      // service by apiKey
      .mockResolvedValueOnce(mockPolicy)       // escalation policy
      .mockResolvedValueOnce(mockTeam);        // team

    mockFindFirst.mockResolvedValueOnce(null); // no existing incident
    (redis.set as jest.Mock).mockResolvedValueOnce('OK'); // SET NX succeeds
    mockCreate
      .mockResolvedValueOnce(mockIncident)    // incident.create
      .mockResolvedValueOnce({})              // incidentEvent.create
      .mockResolvedValueOnce({ id: 'notif-1' }); // notification.create (email)

    (escalationQueue.add as jest.Mock).mockResolvedValueOnce({});
    (notificationQueue.add as jest.Mock).mockResolvedValueOnce({});

    const res = await request(app)
      .post('/alerts')
      .set('X-Api-Key', 'test-api-key-123')
      .send({ dedupKey: 'test-dedup-key', severity: 'HIGH', title: 'Disk full on prod' });

    expect(res.status).toBe(201);
    expect(res.body.incidentId).toBeDefined();
    expect(escalationQueue.add).toHaveBeenCalledTimes(1);
    expect(notificationQueue.add).toHaveBeenCalledTimes(1); // email only (no Slack webhook)
  });

  it('deduplicates: returns 200 and no new incident when dedup key exists in DB', async () => {
    mockFindUnique
      .mockResolvedValueOnce(mockService)
      .mockResolvedValueOnce(mockPolicy)
      .mockResolvedValueOnce(mockTeam);

    mockFindFirst.mockResolvedValueOnce(mockIncident); // existing open incident
    mockCreate.mockResolvedValueOnce({}); // incidentEvent for duplicate

    const res = await request(app)
      .post('/alerts')
      .set('X-Api-Key', 'test-api-key-123')
      .send({ dedupKey: 'test-dedup-key', severity: 'HIGH' });

    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/Duplicate/);
    expect(escalationQueue.add).not.toHaveBeenCalled();
    expect(notificationQueue.add).not.toHaveBeenCalled();
  });

  it('deduplicates: returns 200 when Redis SET NX fails (concurrent race)', async () => {
    mockFindUnique
      .mockResolvedValueOnce(mockService)
      .mockResolvedValueOnce(mockPolicy)
      .mockResolvedValueOnce(mockTeam);

    mockFindFirst.mockResolvedValueOnce(null); // no DB incident yet (concurrent scenario)
    (redis.set as jest.Mock).mockResolvedValueOnce(null); // SET NX fails — lost the race

    const res = await request(app)
      .post('/alerts')
      .set('X-Api-Key', 'test-api-key-123')
      .send({ dedupKey: 'test-dedup-key', severity: 'HIGH' });

    expect(res.status).toBe(200);
    expect(escalationQueue.add).not.toHaveBeenCalled();
  });

  it('enqueues both email AND Slack jobs when team has slackWebhookUrl', async () => {
    const teamWithSlack = { ...mockTeam, slackWebhookUrl: 'https://hooks.slack.com/services/test' };

    mockFindUnique
      .mockResolvedValueOnce(mockService)
      .mockResolvedValueOnce(mockPolicy)
      .mockResolvedValueOnce(teamWithSlack);

    mockFindFirst.mockResolvedValueOnce(null);
    (redis.set as jest.Mock).mockResolvedValueOnce('OK');
    mockCreate
      .mockResolvedValueOnce(mockIncident)
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ id: 'notif-email' })  // email notification
      .mockResolvedValueOnce({ id: 'notif-slack' }); // slack notification

    (escalationQueue.add as jest.Mock).mockResolvedValueOnce({});
    (notificationQueue.add as jest.Mock).mockResolvedValue({});

    const res = await request(app)
      .post('/alerts')
      .set('X-Api-Key', 'test-api-key-123')
      .send({ dedupKey: 'new-key', severity: 'CRITICAL' });

    expect(res.status).toBe(201);
    expect(notificationQueue.add).toHaveBeenCalledTimes(2); // email + slack
    const channels = (notificationQueue.add as jest.Mock).mock.calls.map(
      (call: [string, { channel: string }]) => call[1].channel
    );
    expect(channels).toContain('email');
    expect(channels).toContain('slack');
  });

  it('returns 401 with missing API key', async () => {
    const res = await request(app)
      .post('/alerts')
      .send({ dedupKey: 'key', severity: 'LOW' });

    expect(res.status).toBe(401);
  });
});

describe('POST /incidents/:id/ack', () => {
  beforeEach(() => jest.clearAllMocks());

  it('acknowledges an OPEN incident (RESPONDER)', async () => {
    mockFindUnique
      .mockResolvedValueOnce(mockIncident)   // incident lookup
      .mockResolvedValueOnce(mockService);   // service for team check
    mockUpdate.mockResolvedValueOnce({ ...mockIncident, status: 'ACKED', ackedAt: new Date() });
    mockCreate.mockResolvedValueOnce({}); // incidentEvent

    // Resolve notification enqueuing
    mockFindUnique.mockResolvedValueOnce(mockPolicy);
    mockFindUnique.mockResolvedValueOnce(mockTeam);
    mockCreate.mockResolvedValueOnce({ id: 'notif-1' });
    (notificationQueue.add as jest.Mock).mockResolvedValueOnce({});

    const res = await request(app)
      .post('/incidents/incident-1/ack')
      .set('Authorization', `Bearer ${makeToken('RESPONDER', 'team-1')}`);

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ACKED');
  });

  it('rejects VIEWER from acking', async () => {
    const res = await request(app)
      .post('/incidents/incident-1/ack')
      .set('Authorization', `Bearer ${makeToken('VIEWER', 'team-1')}`);

    expect(res.status).toBe(403);
  });

  it('returns 409 if incident is already ACKED', async () => {
    mockFindUnique.mockResolvedValueOnce({ ...mockIncident, status: 'ACKED' });

    const res = await request(app)
      .post('/incidents/incident-1/ack')
      .set('Authorization', `Bearer ${makeToken('RESPONDER', 'team-1')}`);

    expect(res.status).toBe(409);
  });
});
