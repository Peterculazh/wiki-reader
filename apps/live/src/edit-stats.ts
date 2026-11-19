import { pageKey } from '@app/kafka';
import type { LiveEdit, StatsSnapshot } from '@app/contracts';

const MINUTE_MS = 60_000;

export type EditStatsOptions = {
  windowMinutes: number;
  /** Entries in `topWikis` and `topPages` */
  topN: number;
  /** Wall clock in ms; decides where the window ends */
  now?: () => number;
};

type Bucket = {
  humans: number;
  bots: number;
  wikis: Map<string, number>;
  /** Human article edits per `pageKey` */
  pages: Map<string, number>;
};

type PageInfo = { wiki: string; title: string; titleUrl: string };

/**
 * Rolling counters over the last `windowMinutes` minutes, in memory only.
 *
 * An edit is counted in the minute of its own time (`ts`), so a backlog the
 * ingester replays after a restart fills in the minutes it missed instead of
 * piling onto the current one. The window itself ends at the wall clock's
 * current minute: when the stream stops, the chart drops to zero instead of
 * freezing on the last minute that had edits.
 */
export class EditStats {
  /** Start of the minute in ms -> counts of that minute */
  private readonly buckets = new Map<number, Bucket>();
  // Sums of every bucket in the window, so a snapshot doesn't re-add 60 maps
  private readonly wikiTotals = new Map<string, number>();
  private readonly pageTotals = new Map<string, number>();
  private readonly pageInfo = new Map<string, PageInfo>();
  private readonly now: () => number;

  constructor(private readonly options: EditStatsOptions) {
    this.now = options.now ?? Date.now;
  }

  add(edit: LiveEdit): void {
    const ts = Date.parse(edit.ts);
    if (Number.isNaN(ts)) return;

    this.evict();
    const minute = startOfMinute(ts);
    // Older than the window: it would be evicted right away
    if (minute < this.windowStart()) return;

    let bucket = this.buckets.get(minute);
    if (!bucket) {
      bucket = { humans: 0, bots: 0, wikis: new Map(), pages: new Map() };
      this.buckets.set(minute, bucket);
    }

    if (edit.bot) bucket.bots++;
    else bucket.humans++;
    increment(bucket.wikis, edit.wiki, 1);
    increment(this.wikiTotals, edit.wiki, 1);

    // Same scope as bursts: human edits of articles
    if (!edit.bot && edit.namespace === 0) {
      const key = pageKey(edit.wiki, edit.title);
      increment(bucket.pages, key, 1);
      increment(this.pageTotals, key, 1);
      this.pageInfo.set(key, {
        wiki: edit.wiki,
        title: edit.title,
        titleUrl: edit.titleUrl,
      });
    }
  }

  snapshot(): StatsSnapshot {
    this.evict();
    const end = startOfMinute(this.now());

    const perMinute: StatsSnapshot['perMinute'] = [];
    for (let minute = this.windowStart(); minute <= end; minute += MINUTE_MS) {
      const bucket = this.buckets.get(minute);
      perMinute.push({
        minute: new Date(minute).toISOString(),
        humans: bucket?.humans ?? 0,
        bots: bucket?.bots ?? 0,
      });
    }

    return {
      windowMinutes: this.options.windowMinutes,
      perMinute,
      topWikis: top(this.wikiTotals, this.options.topN).map(
        ([wiki, edits]) => ({ wiki, edits }),
      ),
      topPages: top(this.pageTotals, this.options.topN).map(([key, edits]) => ({
        ...this.pageInfo.get(key)!,
        edits,
      })),
      at: new Date(this.now()).toISOString(),
    };
  }

  private windowStart(): number {
    return (
      startOfMinute(this.now()) - (this.options.windowMinutes - 1) * MINUTE_MS
    );
  }

  /** Drops the minutes that fell out of the window, and their share of the totals. */
  private evict() {
    const start = this.windowStart();
    for (const [minute, bucket] of this.buckets) {
      if (minute >= start) continue;
      for (const [wiki, count] of bucket.wikis) {
        increment(this.wikiTotals, wiki, -count);
      }
      for (const [key, count] of bucket.pages) {
        if (increment(this.pageTotals, key, -count) === 0) {
          this.pageInfo.delete(key);
        }
      }
      this.buckets.delete(minute);
    }
  }
}

function startOfMinute(ms: number): number {
  return Math.floor(ms / MINUTE_MS) * MINUTE_MS;
}

/** Adds `by` to the count of `key` and returns the new count; a count of 0 removes the key. */
function increment(counts: Map<string, number>, key: string, by: number) {
  const next = (counts.get(key) ?? 0) + by;
  if (next > 0) counts.set(key, next);
  else counts.delete(key);
  return Math.max(next, 0);
}

/** The `n` largest counts, largest first; ties keep the order the keys were first counted in. */
function top(counts: Map<string, number>, n: number): [string, number][] {
  const best: [string, number][] = [];
  if (n < 1) return best;
  for (const entry of counts) {
    if (best.length === n && entry[1] <= best[n - 1][1]) continue;
    let i = best.length;
    while (i > 0 && best[i - 1][1] < entry[1]) i--;
    best.splice(i, 0, entry);
    if (best.length > n) best.pop();
  }
  return best;
}
