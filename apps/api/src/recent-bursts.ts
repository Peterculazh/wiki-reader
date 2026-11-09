import type { BurstEvent } from '@app/contracts';

/**
 * The latest `capacity` bursts by `detectedAt`, newest first, each `burstId` once.
 * Bursts arrive in roughly that order, so a new one is placed near the front.
 */
export class RecentBursts {
  private readonly bursts: BurstEvent[] = [];
  private readonly ids = new Set<string>();

  constructor(private readonly capacity: number) {}

  /**
   * False if the burst is already kept, or older than every kept one with the
   * list full. Delivery is at least once, so the same burst can come again.
   */
  add(burst: BurstEvent): boolean {
    if (this.ids.has(burst.burstId)) return false;

    // ISO 8601 strings in UTC sort like the times they stand for
    let i = 0;
    while (
      i < this.bursts.length &&
      this.bursts[i].detectedAt >= burst.detectedAt
    ) {
      i++;
    }
    if (i >= this.capacity) return false;

    this.bursts.splice(i, 0, burst);
    this.ids.add(burst.burstId);
    if (this.bursts.length > this.capacity) {
      this.ids.delete(this.bursts.pop()!.burstId);
    }
    return true;
  }

  /** Up to `limit` bursts, newest first */
  list(limit: number): BurstEvent[] {
    return this.bursts.slice(0, Math.max(0, limit));
  }

  get size(): number {
    return this.bursts.length;
  }
}

/** Parses a `wiki.bursts` value; for anything else, says why it isn't one. */
export function parseBurst(
  value: string | null,
): { burst: BurstEvent } | { invalid: string } {
  if (value === null) return { invalid: 'empty value' };

  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return { invalid: 'malformed JSON' };
  }

  const burst = parsed as Partial<BurstEvent> | null;
  if (
    typeof burst !== 'object' ||
    burst === null ||
    typeof burst.burstId !== 'string' ||
    typeof burst.wiki !== 'string' ||
    typeof burst.title !== 'string' ||
    typeof burst.detectedAt !== 'string' ||
    Number.isNaN(Date.parse(burst.detectedAt))
  ) {
    return { invalid: 'burst without burstId, wiki, title or detectedAt' };
  }
  return { burst: burst as BurstEvent };
}
