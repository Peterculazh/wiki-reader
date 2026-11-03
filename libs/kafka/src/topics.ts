/**
 * Every raw recentchange event, as JSON, keyed by `pageKey(wiki, title)`.
 * The key sends all edits of one page to the same partition, so a consumer
 * that keeps per-page state (bursts) can run one instance per partition.
 */
export const WIKI_CHANGES_TOPIC = 'wiki.changes';
export const WIKI_CHANGES_PARTITIONS = 3;

/** The ingester's resume position, one record under the key `latest`. Compacted. */
export const WIKI_CHANGES_LATEST_TOPIC = 'wiki.changes.latest';

/** One `BurstEvent` per detected burst, keyed by `${wiki}:${title}`. */
export const WIKI_BURSTS_TOPIC = 'wiki.bursts';
export const WIKI_BURSTS_PARTITIONS = 6;

/** Message key for one page, on both `wiki.changes` and `wiki.bursts` */
export const pageKey = (wiki: string, title: string) => `${wiki}:${title}`;
