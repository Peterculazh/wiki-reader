// What apps/api serves to the dashboard: GET /bursts, GET /stats and the GET /live
// stream. Types only. apps/web imports this file with `import type` from outside
// its own project, so the compiler erases it from the bundle and nothing here may
// be a runtime value. For the same reason, import only files that have no imports
// of their own: apps/web has no @nestjs or Kafka packages to resolve them with.

import type { BurstEvent } from '../../kafka/src/events.js';

export type { BurstEvent, BurstRevision } from '../../kafka/src/events.js';

/** One `edit` or `new` event from `wiki.changes`, trimmed to what the dashboard shows */
export type LiveEdit = {
  /**
   * `meta.id` of the recentchange event, unique per event. The same edit can
   * arrive twice after an ingester restart (at least once), so dedupe by it;
   * it also works as a React key.
   */
  id: string;
  /** Database name, e.g. `enwiki`, `wikidatawiki` */
  wiki: string;
  /** Host name, e.g. `en.wikipedia.org` */
  serverName: string;
  title: string;
  titleUrl: string;
  /** This edit's diff; for a new page, its first revision */
  diffUrl: string;
  user: string;
  bot: boolean;
  type: 'edit' | 'new';
  /** 0 is the article namespace */
  namespace: number;
  minor: boolean;
  /** Size change in bytes; for a new page, its whole size */
  delta: number;
  /** Edit summary in wikitext, as the user typed it. Render it as text, not HTML. */
  comment: string;
  /** Event time, ISO 8601 */
  ts: string;
};

/** Edits within one minute of event time */
export type MinuteBucket = {
  /** Start of the minute, ISO 8601 */
  minute: string;
  humans: number;
  bots: number;
};

export type StatsSnapshot = {
  /** Length of the window everything below covers, ending at the current minute */
  windowMinutes: number;
  /** One bucket per minute of the window, oldest first. A minute without edits is all zeros. */
  perMinute: MinuteBucket[];
  /** Busiest wikis in the window, counting edits by humans and bots */
  topWikis: { wiki: string; edits: number }[];
  /** Busiest articles in the window, counting human edits only, the same ones bursts counts */
  topPages: { wiki: string; title: string; titleUrl: string; edits: number }[];
  /** Wall-clock time of the snapshot, ISO 8601 */
  at: string;
};

/** Data of each event on GET /live, by its SSE event name (`EventSource.addEventListener(name, ...)`) */
export type LiveStreamEvents = {
  /** New edits that match the stream's filters, in batches */
  edits: LiveEdit[];
  /** A newly detected burst. After an api restart, recent ones arrive again: dedupe by `burstId`. */
  burst: BurstEvent;
  /** The current stats: once right after connecting, then every few seconds */
  stats: StatsSnapshot;
};

export type LiveStreamEventName = keyof LiveStreamEvents;
