import type { DigestRow } from '../../domain/digest.repository.js';

export type Digest = {
  id: string;
  generatedAt: string;
  hours: number;
  wikis: string[];
  dataUntil: string | null;
  skippedPages: number;
  costUsd: number;
  items: unknown[];
};

export function toDigest(row: DigestRow): Digest {
  return {
    id: row.id,
    generatedAt: row.generated_at.toISOString(),
    hours: row.hours,
    wikis: row.wikis,
    dataUntil: row.data_until?.toISOString() ?? null,
    skippedPages: row.skipped_pages,
    costUsd: Number(row.cost_usd),
    items: row.items,
  };
}
