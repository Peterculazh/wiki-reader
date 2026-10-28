// Message payloads shared between the apps, as they appear on the topics in topics.ts

/**
 * One event of Wikimedia's recentchange stream (https://schema.wikimedia.org/#!/primary/jsonschema/mediawiki/recentchange),
 * stored as-is on `wiki.changes`. Only `edit` and `new` carry `revision` and `length`.
 */
export type RecentChangeEvent = {
  $schema: string;
  meta: {
    uri: string;
    request_id: string;
    id: string;
    /** `canary` for Wikimedia's own synthetic monitoring events */
    domain: string;
    stream: string;
    /** Event time, ISO 8601 */
    dt: string;
    topic: string;
    partition: number;
    offset: number;
  };
  id: number;
  type: 'edit' | 'new' | 'log' | 'categorize' | 'external';
  namespace: number;
  title: string;
  title_url: string;
  comment: string;
  timestamp: number;
  user: string;
  bot: boolean;
  minor?: boolean;
  patrolled?: boolean;
  /** `old` is absent for new pages */
  length?: { old?: number; new: number };
  /** `old` is absent for new pages */
  revision?: { old?: number; new: number };
  notify_url: string;
  server_url: string;
  server_name: string;
  server_script_path: string;
  wiki: string;
  parsedcomment: string;
};

export type BurstRevision = {
  rev: number;
  /** Absent for the edit that created the page */
  oldRev?: number;
  user: string;
  /** Event time of the edit, ISO 8601 */
  ts: string;
};

/** Value on `wiki.bursts`: one page edited by many distinct humans within a short window. */
export type BurstEvent = {
  /** `${wiki}:${title}:${windowStart}`; consumers dedupe by it */
  burstId: string;
  wiki: string;
  title: string;
  serverUrl: string;
  titleUrl: string;
  /** Distinct users in the window */
  authors: number;
  users: string[];
  editCount: number;
  /** Event time of the first and last edit in the window, ISO 8601 */
  windowStart: string;
  windowEnd: string;
  /** Diffs can be fetched from `serverUrl` by these revision ids */
  revisions: BurstRevision[];
  /** Wall-clock time of detection, ISO 8601 */
  detectedAt: string;
};
