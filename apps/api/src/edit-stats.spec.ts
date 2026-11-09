import type { LiveEdit } from '@app/contracts';
import { EditStats } from './edit-stats.js';

const CURRENT_MINUTE = Date.parse('2026-11-07T12:30:00Z');

/** Event time `minutes` before the current minute started, plus `seconds` */
const minutesAgo = (minutes: number, seconds = 0) =>
  new Date(CURRENT_MINUTE - minutes * 60_000 + seconds * 1_000).toISOString();

let nextId = 1;
const edit = (overrides: Partial<LiveEdit> = {}): LiveEdit => ({
  id: `event-${nextId++}`,
  wiki: 'enwiki',
  serverName: 'en.wikipedia.org',
  title: 'Page',
  titleUrl: 'https://en.wikipedia.org/wiki/Page',
  diffUrl: 'https://en.wikipedia.org/w/index.php?diff=2&oldid=1',
  user: 'Alice',
  bot: false,
  type: 'edit',
  namespace: 0,
  minor: false,
  delta: 1,
  comment: '',
  ts: minutesAgo(0, 5),
  ...overrides,
});

describe('EditStats', () => {
  let now: number;
  const newStats = (windowMinutes = 3, topN = 2) =>
    new EditStats({ windowMinutes, topN, now: () => now });

  beforeEach(() => {
    now = CURRENT_MINUTE + 20_000;
  });

  it('counts humans and bots per minute of event time, oldest first', () => {
    const stats = newStats();
    stats.add(edit({ ts: minutesAgo(0, 5) }));
    stats.add(edit({ ts: minutesAgo(0, 10), bot: true }));
    stats.add(edit({ ts: minutesAgo(2, 30) }));

    expect(stats.snapshot().perMinute).toEqual([
      { minute: '2026-11-07T12:28:00.000Z', humans: 1, bots: 0 },
      { minute: '2026-11-07T12:29:00.000Z', humans: 0, bots: 0 },
      { minute: '2026-11-07T12:30:00.000Z', humans: 1, bots: 1 },
    ]);
  });

  it('moves the window with the wall clock and drops what falls out of it', () => {
    const stats = newStats();
    stats.add(edit({ ts: minutesAgo(2), wiki: 'dewiki', title: 'Alt' }));
    stats.add(edit({ ts: minutesAgo(0) }));

    // No edits for a minute: the chart shows the gap instead of freezing
    now += 60_000;
    const snapshot = stats.snapshot();

    expect(snapshot.perMinute.map((b) => [b.minute, b.humans])).toEqual([
      ['2026-11-07T12:29:00.000Z', 0],
      ['2026-11-07T12:30:00.000Z', 1],
      ['2026-11-07T12:31:00.000Z', 0],
    ]);
    expect(snapshot.topWikis).toEqual([{ wiki: 'enwiki', edits: 1 }]);
    expect(snapshot.topPages.map((p) => p.title)).toEqual(['Page']);
  });

  it('ignores edits older than the window', () => {
    const stats = newStats();
    stats.add(edit({ ts: minutesAgo(5) }));

    expect(stats.snapshot().topWikis).toEqual([]);
  });

  it('ranks wikis by every edit and articles by human edits only', () => {
    const stats = newStats(3, 2);
    for (const title of ['Q1', 'Q2', 'Q3']) {
      stats.add(edit({ wiki: 'wikidatawiki', title, bot: true }));
    }
    stats.add(edit({ title: 'Hot' }));
    stats.add(edit({ title: 'Hot', user: 'Bob' }));
    stats.add(edit({ title: 'Talk:Hot', namespace: 1 }));
    stats.add(edit({ wiki: 'dewiki', title: 'Heiß' }));

    const { topWikis, topPages } = stats.snapshot();
    // A tie keeps the wiki that was counted first
    expect(topWikis).toEqual([
      { wiki: 'wikidatawiki', edits: 3 },
      { wiki: 'enwiki', edits: 3 },
    ]);
    expect(topPages).toEqual([
      {
        wiki: 'enwiki',
        title: 'Hot',
        titleUrl: 'https://en.wikipedia.org/wiki/Page',
        edits: 2,
      },
      {
        wiki: 'dewiki',
        title: 'Heiß',
        titleUrl: 'https://en.wikipedia.org/wiki/Page',
        edits: 1,
      },
    ]);
  });
});
