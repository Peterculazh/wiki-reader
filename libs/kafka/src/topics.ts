/** Every raw recentchange event, as JSON. Keyless: the ingester doesn't set a key. */
export const WIKI_CHANGES_TOPIC = 'wiki.changes';

/** One `BurstEvent` per detected burst, keyed by `${wiki}:${title}`. */
export const WIKI_BURSTS_TOPIC = 'wiki.bursts';
export const WIKI_BURSTS_PARTITIONS = 6;
