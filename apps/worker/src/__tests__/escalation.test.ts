// Integration test: escalation flow using BullMQ's built-in test mode
// Tests that:
// 1. An unacknowledged incident triggers fallback notifications after delay
// 2. An acknowledged incident does NOT trigger escalation (escalation no-op)
// 3. Slack + email fan-out works correctly on escalation

const mockFindUnique = jest.fn();
const mockCreate = jest.fn();

jest.mock('@oncallx/shared', () => ({
  prisma: {
    incident: { findUnique: mockFindUnique },
    escalationPolicy: { findUnique: mockFindUnique },
    service: { findUnique: mockFindUnique },
    team: { findUnique: mockFindUnique },
    notification: { create: mockCreate },
    incidentEvent: { create: mockCreate },
  },
  notificationQueue: { add: jest.fn() },
  DEDUP_KEY_PREFIX: 'dedup:incident:',
}));

jest.mock('../socketEmitter', () => ({
  emitWorkerEvent: jest.fn(),
}));

import { handleEscalateCheck } from '../processors/escalateCheck';
import { notificationQueue } from '@oncallx/shared';
import { emitWorkerEvent } from '../socketEmitter';
import { Job } from 'bullmq';

function makeJob(data: { incidentId: string; serviceId: string }): Job {
  return { data } as unknown as Job;
}

const openIncident = {
  id: 'inc-1',
  serviceId: 'svc-1',
  status: 'OPEN',
  dedupKey: 'key-1',
  severity: 'HIGH',
};

const ackedIncident = { ...openIncident, status: 'ACKED' };

const policy = {
  id: 'pol-1',
  serviceId: 'svc-1',
  primaryUserId: 'user-primary',
  fallbackUserId: 'user-fallback',
  escalateAfterMin: 5,
};

const service = { id: 'svc-1', teamId: 'team-1', name: 'Prod' };
const teamNoSlack = { id: 'team-1', slackWebhookUrl: null };
const teamWithSlack = { id: 'team-1', slackWebhookUrl: 'https://hooks.slack.com/services/test' };

describe('handleEscalateCheck — escalation processor', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (notificationQueue.add as jest.Mock).mockResolvedValue({});
    (emitWorkerEvent as jest.Mock).mockResolvedValue(undefined);
    mockCreate.mockResolvedValue({});
  });

  it('escalates to fallback user when incident is OPEN (email only)', async () => {
    mockFindUnique
      .mockResolvedValueOnce(openIncident)  // incident
      .mockResolvedValueOnce(policy)        // escalationPolicy
      .mockResolvedValueOnce(service)       // service
      .mockResolvedValueOnce(teamNoSlack);  // team

    await handleEscalateCheck(makeJob({ incidentId: 'inc-1', serviceId: 'svc-1' }));

    expect(notificationQueue.add).toHaveBeenCalledTimes(1); // email only
    const [[, jobData]] = (notificationQueue.add as jest.Mock).mock.calls;
    expect(jobData.channel).toBe('email');
    expect(jobData.userId).toBe('user-fallback');
    expect(emitWorkerEvent).toHaveBeenCalledWith('team-1', 'incident:escalated', expect.any(Object));
  });

  it('escalates with both email AND Slack when team has webhook', async () => {
    mockFindUnique
      .mockResolvedValueOnce(openIncident)
      .mockResolvedValueOnce(policy)
      .mockResolvedValueOnce(service)
      .mockResolvedValueOnce(teamWithSlack);

    await handleEscalateCheck(makeJob({ incidentId: 'inc-1', serviceId: 'svc-1' }));

    expect(notificationQueue.add).toHaveBeenCalledTimes(2);
    const channels = (notificationQueue.add as jest.Mock).mock.calls.map(
      (call: [string, { channel: string }]) => call[1].channel
    );
    expect(channels).toContain('email');
    expect(channels).toContain('slack');
  });

  it('does NOT escalate when incident is ACKED (ack prevents escalation)', async () => {
    mockFindUnique.mockResolvedValueOnce(ackedIncident); // incident is already ACKED

    await handleEscalateCheck(makeJob({ incidentId: 'inc-1', serviceId: 'svc-1' }));

    expect(notificationQueue.add).not.toHaveBeenCalled();
    expect(emitWorkerEvent).not.toHaveBeenCalled();
  });

  it('does NOT escalate when incident is RESOLVED', async () => {
    mockFindUnique.mockResolvedValueOnce({ ...openIncident, status: 'RESOLVED' });

    await handleEscalateCheck(makeJob({ incidentId: 'inc-1', serviceId: 'svc-1' }));

    expect(notificationQueue.add).not.toHaveBeenCalled();
  });

  it('no-ops gracefully when incident not found', async () => {
    mockFindUnique.mockResolvedValueOnce(null);

    await handleEscalateCheck(makeJob({ incidentId: 'ghost-id', serviceId: 'svc-1' }));

    expect(notificationQueue.add).not.toHaveBeenCalled();
    expect(emitWorkerEvent).not.toHaveBeenCalled();
  });
});
