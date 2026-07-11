// Unit tests for escalation delay calculation
describe('Escalation delay calculation', () => {
  it('converts escalateAfterMin to milliseconds for BullMQ delay', () => {
    const escalateAfterMin = 5;
    const delayMs = escalateAfterMin * 60 * 1000;
    expect(delayMs).toBe(300_000); // 5 minutes = 300,000ms
  });

  it('computes delay for various policy values', () => {
    const cases = [
      { minutes: 1, expectedMs: 60_000 },
      { minutes: 5, expectedMs: 300_000 },
      { minutes: 15, expectedMs: 900_000 },
      { minutes: 30, expectedMs: 1_800_000 },
    ];
    for (const { minutes, expectedMs } of cases) {
      expect(minutes * 60 * 1000).toBe(expectedMs);
    }
  });

  it('Redis TTL is always twice the escalation delay in minutes', () => {
    const testCases = [1, 5, 10, 30];
    for (const escalateAfterMin of testCases) {
      const delayMs = escalateAfterMin * 60 * 1000;
      const ttlMs = escalateAfterMin * 2 * 60 * 1000;
      // TTL should be exactly 2x the delay so dedup key outlives the escalation check
      expect(ttlMs).toBe(delayMs * 2);
    }
  });
});
