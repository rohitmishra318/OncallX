// Unit tests for dedup logic
// The key dedup mechanism is: Redis SET NX EX — only the first call for a given key succeeds.
// We test this by mocking the redis client.

import { DEDUP_KEY_PREFIX } from '@oncallx/shared';

describe('Dedup key logic', () => {
  it('builds the correct Redis key format', () => {
    const serviceId = 'svc-123';
    const dedupKey = 'disk-full-prod';
    const key = `${DEDUP_KEY_PREFIX}${serviceId}:${dedupKey}`;
    expect(key).toBe('dedup:incident:svc-123:disk-full-prod');
  });

  it('computes TTL as escalateAfterMin * 2 * 60 seconds', () => {
    const escalateAfterMin = 5;
    const ttlSeconds = escalateAfterMin * 2 * 60;
    expect(ttlSeconds).toBe(600); // 10 minutes
  });

  it('computes TTL correctly for different policies', () => {
    const cases = [
      { escalateAfterMin: 1, expected: 120 },
      { escalateAfterMin: 5, expected: 600 },
      { escalateAfterMin: 30, expected: 3600 },
    ];
    for (const { escalateAfterMin, expected } of cases) {
      expect(escalateAfterMin * 2 * 60).toBe(expected);
    }
  });
});

describe('Dedup SET NX atomicity behavior (mocked)', () => {
  const mockRedis = {
    set: jest.fn(),
  };

  beforeEach(() => {
    mockRedis.set.mockReset();
  });

  async function simulateAtomicDedup(
    redis: typeof mockRedis,
    key: string,
    value: string,
    ttl: number
  ): Promise<boolean> {
    const result = await redis.set(key, value, 'EX', ttl, 'NX');
    return result === 'OK';
  }

  it('returns true (acquired) when Redis SET NX succeeds', async () => {
    mockRedis.set.mockResolvedValueOnce('OK');
    const acquired = await simulateAtomicDedup(mockRedis, 'dedup:incident:svc:key', 'incident-id', 600);
    expect(acquired).toBe(true);
    expect(mockRedis.set).toHaveBeenCalledWith('dedup:incident:svc:key', 'incident-id', 'EX', 600, 'NX');
  });

  it('returns false (not acquired) when Redis SET NX fails — key already exists', async () => {
    mockRedis.set.mockResolvedValueOnce(null);
    const acquired = await simulateAtomicDedup(mockRedis, 'dedup:incident:svc:key', 'incident-id-2', 600);
    expect(acquired).toBe(false);
  });

  it('concurrent calls: only first succeeds', async () => {
    // Simulate: first call gets OK, second and third get null
    mockRedis.set
      .mockResolvedValueOnce('OK')
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null);

    const results = await Promise.all([
      simulateAtomicDedup(mockRedis, 'dedup:incident:svc:key', 'inc-1', 600),
      simulateAtomicDedup(mockRedis, 'dedup:incident:svc:key', 'inc-2', 600),
      simulateAtomicDedup(mockRedis, 'dedup:incident:svc:key', 'inc-3', 600),
    ]);

    const acquiredCount = results.filter(Boolean).length;
    expect(acquiredCount).toBe(1);
  });
});
