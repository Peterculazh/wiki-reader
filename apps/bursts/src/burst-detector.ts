import { pageKey, type BurstEvent, type RecentChangeEvent } from '@app/kafka';

export type BurstDetectorOptions = {
  windowMs: number;
  minAuthors: number;
  cooldownMs: number;
  /**
   * A burst whose last edit is older than this by the wall clock is history,
   * not news: it is counted but not returned, e.g. while catching up on a
   * backlog. Unset: every burst is returned.
   */
  maxLagMs?: number;
  /**
   * Wall clock, used only for `detectedAt` and the `maxLagMs` check. Windows
   * and cooldowns use event time.
   */
  now?: () => Date;
  /** Receives one line per skipped malformed message */
  warn?: (message: string) => void;
};

export type BurstDetectorStats = {
  /** Every message handed to `process` */
  eventsSeen: number;
  /** Human article edits that passed the filter */
  eventsAccepted: number;
  /** Malformed JSON or missing fields */
  eventsInvalid: number;
  keysTracked: number;
  burstsEmitted: number;
  /** Bursts older than `maxLagMs`, not returned */
  burstsStale: number;
};

type TrackedEdit = { user: string; ts: number; rev: number; oldRev?: number };

type PageState = {
  wiki: string;
  title: string;
  serverUrl: string;
  titleUrl: string;
  /** Edits inside the window, sorted by `ts` */
  edits: TrackedEdit[];
  /** Event time before which this page can't fire again */
  cooldownUntil: number;
};

type ParsedEdit = Omit<PageState, 'edits' | 'cooldownUntil'> & TrackedEdit;

const TRACKED_TYPES: ReadonlySet<string> = new Set(['edit', 'new']);

/**
 * Finds pages edited by at least `minAuthors` distinct humans within `windowMs`.
 * All window logic runs on the events' `meta.dt`, never on the wall clock: while
 * catching up, hours of backlog arrive within minutes and would otherwise all
 * fall into one window.
 */
export class BurstDetector {
  private readonly pages = new Map<string, PageState>();
  /** Largest `meta.dt` seen so far */
  private watermark = -Infinity;
  private readonly counters = {
    eventsSeen: 0,
    eventsAccepted: 0,
    eventsInvalid: 0,
    burstsEmitted: 0,
    burstsStale: 0,
  };
  private readonly now: () => Date;
  private readonly warn: (message: string) => void;

  constructor(private readonly options: BurstDetectorOptions) {
    this.now = options.now ?? (() => new Date());
    this.warn = options.warn ?? (() => {});
  }

  /** Takes a raw `wiki.changes` value; returns the burst it completes, if any. Never throws. */
  process(value: string | null): BurstEvent | null {
    this.counters.eventsSeen++;
    try {
      const edit = this.parse(value);
      return edit ? this.track(edit) : null;
    } catch (err) {
      // Last guard: a bug in here must not block the partition
      return this.invalid(`unexpected error ${String(err)}`, value);
    }
  }

  /** Drops pages that have been idle for a whole window and are out of cooldown. */
  evict(): number {
    const cutoff = this.watermark - this.options.windowMs;
    let removed = 0;
    for (const [key, page] of this.pages) {
      const newest = page.edits[page.edits.length - 1].ts;
      if (newest <= cutoff && page.cooldownUntil <= this.watermark) {
        this.pages.delete(key);
        removed++;
      }
    }
    return removed;
  }

  stats(): BurstDetectorStats {
    return { ...this.counters, keysTracked: this.pages.size };
  }

  /** Null for filtered-out events (silently) and malformed ones (with a warning). */
  private parse(value: string | null): ParsedEdit | null {
    if (value === null) return this.invalid('empty value', value);

    let parsed: unknown;
    try {
      parsed = JSON.parse(value);
    } catch {
      return this.invalid('malformed JSON', value);
    }

    if (!isRecord(parsed) || !isRecord(parsed.meta)) {
      return this.invalid('no meta', value);
    }
    const event = parsed as Partial<RecentChangeEvent> &
      Pick<RecentChangeEvent, 'meta'>;
    if (
      typeof event.bot !== 'boolean' ||
      typeof event.type !== 'string' ||
      typeof event.namespace !== 'number'
    ) {
      return this.invalid('missing bot, type or namespace', value);
    }

    // Valid but out of scope: no warning, there are many of these
    if (
      event.bot ||
      !TRACKED_TYPES.has(event.type) ||
      event.namespace !== 0 ||
      event.meta.domain === 'canary'
    ) {
      return null;
    }

    const ts =
      typeof event.meta.dt === 'string' ? Date.parse(event.meta.dt) : NaN;
    const rev = event.revision?.new;
    const oldRev = event.revision?.old;
    if (
      !isNonEmptyString(event.wiki) ||
      !isNonEmptyString(event.title) ||
      !isNonEmptyString(event.user) ||
      !isNonEmptyString(event.server_url) ||
      !isNonEmptyString(event.title_url) ||
      Number.isNaN(ts) ||
      typeof rev !== 'number'
    ) {
      return this.invalid(
        'edit without wiki, title, user, urls, meta.dt or revision.new',
        value,
      );
    }

    return {
      wiki: event.wiki,
      title: event.title,
      serverUrl: event.server_url,
      titleUrl: event.title_url,
      user: event.user,
      ts,
      rev,
      // Absent for new pages; JSON.stringify drops it from the burst then
      oldRev: typeof oldRev === 'number' ? oldRev : undefined,
    };
  }

  private track(edit: ParsedEdit): BurstEvent | null {
    this.counters.eventsAccepted++;
    this.watermark = Math.max(this.watermark, edit.ts);

    const key = pageKey(edit.wiki, edit.title);
    let page = this.pages.get(key);
    if (!page) {
      page = {
        wiki: edit.wiki,
        title: edit.title,
        serverUrl: edit.serverUrl,
        titleUrl: edit.titleUrl,
        edits: [],
        cooldownUntil: -Infinity,
      };
      this.pages.set(key, page);
    }

    // Redelivered after a rebalance: already in the window
    if (page.edits.some((e) => e.rev === edit.rev)) return null;

    // Events arrive almost in order, so the slot is found near the end
    const { edits } = page;
    let i = edits.length;
    while (i > 0 && edits[i - 1].ts > edit.ts) i--;
    edits.splice(i, 0, {
      user: edit.user,
      ts: edit.ts,
      rev: edit.rev,
      oldRev: edit.oldRev,
    });

    // Anchored at the page's newest edit, not at this one: a late event then
    // can't stretch the window beyond windowMs. The newest edit always stays.
    const pageNow = edits[edits.length - 1].ts;
    const cutoff = pageNow - this.options.windowMs;
    edits.splice(
      0,
      edits.findIndex((e) => e.ts > cutoff),
    );

    // Same user editing twice counts once
    const users = [...new Set(edits.map((e) => e.user))];
    if (users.length < this.options.minAuthors) return null;
    if (pageNow < page.cooldownUntil) return null;

    // No cooldown for a stale burst: if the page is still hot once the
    // backlog is consumed, the live burst must not be muted by an old one
    const detectedAt = this.now();
    if (detectedAt.getTime() - pageNow > (this.options.maxLagMs ?? Infinity)) {
      this.counters.burstsStale++;
      return null;
    }

    page.cooldownUntil = pageNow + this.options.cooldownMs;
    this.counters.burstsEmitted++;

    const windowStart = new Date(edits[0].ts).toISOString();
    return {
      burstId: `${key}:${windowStart}`,
      wiki: page.wiki,
      title: page.title,
      serverUrl: page.serverUrl,
      titleUrl: page.titleUrl,
      authors: users.length,
      users,
      editCount: edits.length,
      windowStart,
      windowEnd: new Date(pageNow).toISOString(),
      revisions: edits.map((e) => ({
        rev: e.rev,
        oldRev: e.oldRev,
        user: e.user,
        ts: new Date(e.ts).toISOString(),
      })),
      detectedAt: detectedAt.toISOString(),
    };
  }

  private invalid(reason: string, value: string | null): null {
    this.counters.eventsInvalid++;
    this.warn(`Skipping message (${reason}): ${preview(value)}`);
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function preview(value: string | null): string {
  if (value === null) return 'null';
  return value.length > 200 ? `${value.slice(0, 200)}…` : value;
}
