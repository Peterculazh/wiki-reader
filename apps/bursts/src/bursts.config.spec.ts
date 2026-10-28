import { burstsConfigFromEnv } from './bursts.config.js';

describe('burstsConfigFromEnv', () => {
  it('uses the defaults when nothing is set', () => {
    expect(burstsConfigFromEnv({})).toEqual({
      windowMs: 600_000,
      minAuthors: 3,
      cooldownMs: 3_600_000,
      maxLagMs: 900_000,
      evictIntervalMs: 60_000,
    });
  });

  it('reads overrides', () => {
    expect(
      burstsConfigFromEnv({
        BURST_MIN_AUTHORS: '5',
        BURST_WINDOW_MS: '300000',
      }),
    ).toMatchObject({ minAuthors: 5, windowMs: 300_000 });
  });

  it.each(['abc', '0', '-1', '1.5'])('rejects %s', (raw) => {
    expect(() => burstsConfigFromEnv({ BURST_MIN_AUTHORS: raw })).toThrow(
      'BURST_MIN_AUTHORS must be a positive integer',
    );
  });
});
