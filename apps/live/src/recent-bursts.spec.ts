import type { BurstEvent } from '@app/contracts';
import { parseBurst, RecentBursts } from './recent-bursts.js';

const burst = (title: string, minute: number): BurstEvent => {
  const at = new Date(Date.UTC(2026, 10, 7, 12, minute)).toISOString();
  return {
    burstId: `enwiki:${title}:${at}`,
    wiki: 'enwiki',
    title,
    serverUrl: 'https://en.wikipedia.org',
    titleUrl: `https://en.wikipedia.org/wiki/${title}`,
    authors: 3,
    users: ['Alice', 'Bob', 'Carol'],
    editCount: 3,
    windowStart: at,
    windowEnd: at,
    revisions: [],
    detectedAt: at,
  };
};

const titles = (bursts: BurstEvent[]) => bursts.map((b) => b.title);

describe('RecentBursts', () => {
  it('lists bursts newest first, whatever order they arrive in', () => {
    const recent = new RecentBursts(10);
    recent.add(burst('B', 2));
    recent.add(burst('A', 1));
    recent.add(burst('C', 3));

    expect(titles(recent.list(10))).toEqual(['C', 'B', 'A']);
    expect(titles(recent.list(2))).toEqual(['C', 'B']);
  });

  it('keeps each burstId once', () => {
    const recent = new RecentBursts(10);

    expect(recent.add(burst('A', 1))).toBe(true);
    expect(recent.add(burst('A', 1))).toBe(false);
    expect(recent.size).toBe(1);
  });

  it('keeps only the latest ones once full', () => {
    const recent = new RecentBursts(2);
    recent.add(burst('A', 1));
    recent.add(burst('B', 2));
    recent.add(burst('C', 3));

    expect(titles(recent.list(10))).toEqual(['C', 'B']);
    // Older than everything kept: not news anymore, including the one dropped above
    expect(recent.add(burst('Old', 0))).toBe(false);
    expect(recent.add(burst('A', 1))).toBe(false);
    expect(titles(recent.list(10))).toEqual(['C', 'B']);
  });
});

describe('parseBurst', () => {
  it('parses a wiki.bursts value', () => {
    const value = burst('A', 1);

    expect(parseBurst(JSON.stringify(value))).toEqual({ burst: value });
  });

  it.each([
    ['an empty value', null],
    ['malformed JSON', 'not json'],
    ['JSON that is not a burst', '{"title":"A"}'],
    [
      'a burst without a valid detectedAt',
      '{"burstId":"x","wiki":"enwiki","title":"A","detectedAt":"soon"}',
    ],
  ])('rejects %s', (_, value) => {
    expect(parseBurst(value)).toHaveProperty('invalid');
  });
});
