import { BurstDetector } from './burst-detector.js';

const T0 = Date.parse('2026-10-27T12:00:00.000Z');
const MIN = 60_000;
const iso = (offsetMs: number) => new Date(T0 + offsetMs).toISOString();

let nextRev = 1_000;

/** A human article edit on enwiki `title`, `at` ms after T0; any field can be overridden. */
function change({
  user = 'Alice',
  at = 0,
  title = 'Some_page',
  rev = nextRev++,
  ...overrides
}: {
  user?: string;
  at?: number;
  title?: string;
  rev?: number;
  [field: string]: unknown;
} = {}): string {
  return JSON.stringify({
    meta: { domain: 'en.wikipedia.org', dt: iso(at) },
    type: 'edit',
    namespace: 0,
    bot: false,
    wiki: 'enwiki',
    title,
    title_url: `https://en.wikipedia.org/wiki/${title}`,
    server_url: 'https://en.wikipedia.org',
    user,
    revision: { old: rev - 1, new: rev },
    ...overrides,
  });
}

describe('BurstDetector', () => {
  let warn: ReturnType<typeof vi.fn<(message: string) => void>>;
  let detector: BurstDetector;

  beforeEach(() => {
    warn = vi.fn();
    detector = new BurstDetector({
      windowMs: 10 * MIN,
      minAuthors: 3,
      cooldownMs: 60 * MIN,
      now: () => new Date('2026-10-27T13:00:00.000Z'),
      warn,
    });
  });

  const feed = (...values: (string | null)[]) =>
    values.map((value) => detector.process(value));

  it('counts the same user editing twice as one author', () => {
    expect(
      feed(
        change({ user: 'Alice', at: 0 }),
        change({ user: 'Alice', at: 1 * MIN }),
        change({ user: 'Bob', at: 2 * MIN }),
      ),
    ).toEqual([null, null, null]);

    const burst = detector.process(change({ user: 'Carol', at: 3 * MIN }));

    expect(burst).toMatchObject({
      authors: 3,
      users: ['Alice', 'Bob', 'Carol'],
      editCount: 4,
    });
  });

  it('ignores redelivered revisions', () => {
    feed(
      change({ user: 'Alice', rev: 1 }),
      change({ user: 'Bob', rev: 2, at: MIN }),
      change({ user: 'Alice', rev: 1 }),
    );

    const burst = detector.process(
      change({ user: 'Carol', rev: 3, at: 2 * MIN }),
    );

    expect(burst?.editCount).toBe(3);
    expect(burst?.revisions.map((r) => r.rev)).toEqual([1, 2, 3]);
  });

  it.each([
    ['bots', { bot: true }],
    ['log events', { type: 'log' }],
    ['categorize events', { type: 'categorize' }],
    ['non-article namespaces', { namespace: 1 }],
    ['canary events', { meta: { domain: 'canary', dt: iso(0) } }],
  ])('ignores %s', (_, overrides) => {
    const results = ['Alice', 'Bob', 'Carol', 'Dave'].map((user, i) =>
      detector.process(change({ user, at: i * MIN, ...overrides })),
    );

    expect(results).toEqual([null, null, null, null]);
    expect(detector.stats()).toMatchObject({
      eventsSeen: 4,
      eventsAccepted: 0,
      eventsInvalid: 0,
      keysTracked: 0,
    });
    expect(warn).not.toHaveBeenCalled();
  });

  it('slides old edits out of the window', () => {
    expect(
      feed(
        change({ user: 'Alice', at: 0 }),
        change({ user: 'Bob', at: 5 * MIN }),
        // Alice is 11 minutes old by now
        change({ user: 'Carol', at: 11 * MIN }),
      ),
    ).toEqual([null, null, null]);

    const burst = detector.process(change({ user: 'Dave', at: 12 * MIN }));

    expect(burst).toMatchObject({
      users: ['Bob', 'Carol', 'Dave'],
      windowStart: iso(5 * MIN),
      windowEnd: iso(12 * MIN),
    });
  });

  it('treats an edit exactly one window old as outside', () => {
    expect(
      feed(
        change({ user: 'Alice', at: 0 }),
        change({ user: 'Bob', at: 5 * MIN }),
        change({ user: 'Carol', at: 10 * MIN }),
      ),
    ).toEqual([null, null, null]);
  });

  it('emits exactly one burst on reaching N, with every field', () => {
    const results = feed(
      // Page creation: no old revision
      change({ user: 'Alice', at: 0, type: 'new', revision: { new: 1 } }),
      change({ user: 'Bob', at: 1 * MIN, rev: 2 }),
      change({ user: 'Carol', at: 2 * MIN, rev: 3 }),
    );

    expect(results.slice(0, 2)).toEqual([null, null]);
    expect(results[2]).toEqual({
      burstId: `enwiki:Some_page:${iso(0)}`,
      wiki: 'enwiki',
      title: 'Some_page',
      serverUrl: 'https://en.wikipedia.org',
      titleUrl: 'https://en.wikipedia.org/wiki/Some_page',
      authors: 3,
      users: ['Alice', 'Bob', 'Carol'],
      editCount: 3,
      windowStart: iso(0),
      windowEnd: iso(2 * MIN),
      revisions: [
        { rev: 1, user: 'Alice', ts: iso(0) },
        { rev: 2, oldRev: 1, user: 'Bob', ts: iso(1 * MIN) },
        { rev: 3, oldRev: 2, user: 'Carol', ts: iso(2 * MIN) },
      ],
      detectedAt: '2026-10-27T13:00:00.000Z',
    });
    // The new page's revision has no oldRev on the wire
    expect(JSON.parse(JSON.stringify(results[2])).revisions[0]).toEqual({
      rev: 1,
      user: 'Alice',
      ts: iso(0),
    });
    expect(detector.stats().burstsEmitted).toBe(1);
  });

  it('stays quiet during the cooldown and fires again after it', () => {
    feed(
      change({ user: 'Alice', at: 0 }),
      change({ user: 'Bob', at: 1 * MIN }),
      change({ user: 'Carol', at: 2 * MIN }),
    );

    // Cooldown runs until 2 + 60 = 62 minutes of event time
    expect(
      feed(
        change({ user: 'Dave', at: 3 * MIN }),
        change({ user: 'Erin', at: 4 * MIN }),
        change({ user: 'Frank', at: 55 * MIN }),
        change({ user: 'Grace', at: 58 * MIN }),
        change({ user: 'Heidi', at: 61 * MIN }),
      ),
    ).toEqual([null, null, null, null, null]);

    const again = detector.process(change({ user: 'Ivan', at: 62 * MIN }));

    expect(again).toMatchObject({
      burstId: `enwiki:Some_page:${iso(55 * MIN)}`,
      users: ['Frank', 'Grace', 'Heidi', 'Ivan'],
    });
    expect(detector.stats().burstsEmitted).toBe(2);
  });

  it('evicts keys idle for a whole window, but not ones in cooldown', () => {
    feed(
      change({ title: 'Quiet', user: 'Alice', at: 0 }),
      change({ title: 'Hot', user: 'Alice', at: 0 }),
      change({ title: 'Hot', user: 'Bob', at: 1 * MIN }),
      change({ title: 'Hot', user: 'Carol', at: 2 * MIN }),
      // Moves the watermark to 20 minutes
      change({ title: 'Other', user: 'Dave', at: 20 * MIN }),
    );
    expect(detector.stats().keysTracked).toBe(3);

    expect(detector.evict()).toBe(1);
    // Hot is still in cooldown until 62 minutes; Other is recent
    expect(detector.stats().keysTracked).toBe(2);

    detector.process(change({ title: 'Other', user: 'Dave', at: 62 * MIN }));
    expect(detector.evict()).toBe(1);
    expect(detector.stats().keysTracked).toBe(1);
  });

  it('uses event time: edits spread over 30 minutes are no burst, however fast they arrive', () => {
    const users = ['Alice', 'Bob', 'Carol', 'Dave', 'Erin', 'Frank'];

    // One synchronous loop: no wall-clock time passes, 6 minutes apart in meta.dt
    const results = users.map((user, i) =>
      detector.process(change({ user, at: i * 6 * MIN })),
    );

    expect(results.every((r) => r === null)).toBe(true);
    expect(detector.stats().burstsEmitted).toBe(0);
  });

  it('tolerates slightly out-of-order meta.dt', () => {
    const results = feed(
      change({ user: 'Alice', at: 5 * MIN }),
      change({ user: 'Bob', at: 3 * MIN }),
      change({ user: 'Carol', at: 4 * MIN }),
    );

    expect(results[2]).toMatchObject({
      users: ['Bob', 'Carol', 'Alice'],
      windowStart: iso(3 * MIN),
      windowEnd: iso(5 * MIN),
    });
  });

  it('drops an edit that arrives more than a window late', () => {
    feed(
      change({ user: 'Alice', at: 20 * MIN }),
      change({ user: 'Bob', at: 5 * MIN }),
      change({ user: 'Carol', at: 21 * MIN }),
    );

    const burst = detector.process(change({ user: 'Dave', at: 22 * MIN }));

    expect(burst).toMatchObject({
      users: ['Alice', 'Carol', 'Dave'],
      windowStart: iso(20 * MIN),
      windowEnd: iso(22 * MIN),
    });
  });

  it('skips malformed input with a warning, without throwing', () => {
    const edit = JSON.parse(change()) as Record<string, unknown>;
    const without = (field: string) =>
      JSON.stringify({ ...edit, [field]: undefined });

    const malformed = [
      null,
      'not json',
      '42',
      '[]',
      '{}',
      JSON.stringify({ ...edit, meta: undefined }),
      without('bot'),
      without('user'),
      without('title'),
      without('revision'),
      JSON.stringify({ ...edit, meta: { domain: 'x', dt: 'yesterday' } }),
    ];

    expect(() => feed(...malformed)).not.toThrow();
    expect(warn).toHaveBeenCalledTimes(malformed.length);
    expect(detector.stats()).toMatchObject({
      eventsSeen: malformed.length,
      eventsInvalid: malformed.length,
      eventsAccepted: 0,
      keysTracked: 0,
    });

    // Still works afterwards
    const results = feed(
      change({ user: 'Alice' }),
      change({ user: 'Bob' }),
      change({ user: 'Carol' }),
    );
    expect(results[2]).not.toBeNull();
  });

  describe('maxLagMs', () => {
    const lagging = (nowOffsetMs: number) =>
      new BurstDetector({
        windowMs: 10 * MIN,
        minAuthors: 3,
        cooldownMs: 60 * MIN,
        maxLagMs: 15 * MIN,
        now: () => new Date(T0 + nowOffsetMs),
      });

    it('skips a burst older than maxLagMs by the wall clock, without starting a cooldown', () => {
      // Catching up: the wall clock is 70 minutes past the first edits
      const catchingUp = lagging(70 * MIN);

      expect(
        ['Alice', 'Bob', 'Carol'].map((user, i) =>
          catchingUp.process(change({ user, at: i * MIN })),
        ),
      ).toEqual([null, null, null]);
      expect(catchingUp.stats()).toMatchObject({
        burstsStale: 1,
        burstsEmitted: 0,
      });

      // 12 minutes old: news again. A cooldown from the stale burst would run
      // until 62 minutes and mute this one.
      const results = ['Dave', 'Erin', 'Frank'].map((user, i) =>
        catchingUp.process(change({ user, at: (56 + i) * MIN })),
      );
      expect(results[2]).toMatchObject({ users: ['Dave', 'Erin', 'Frank'] });
      expect(catchingUp.stats()).toMatchObject({
        burstsStale: 1,
        burstsEmitted: 1,
      });
    });

    it('still publishes a burst exactly maxLagMs old', () => {
      const detector = lagging(17 * MIN);

      const results = ['Alice', 'Bob', 'Carol'].map((user, i) =>
        detector.process(change({ user, at: i * MIN })),
      );

      expect(results[2]).not.toBeNull();
    });
  });
});
