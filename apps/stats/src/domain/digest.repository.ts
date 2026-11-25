import { Inject, Injectable } from '@nestjs/common';
import type { Pool } from 'pg';
import { DB_POOL } from '@app/postgres';

export type DigestCreate = {
  generatedAt: string;
  hours: number;
  wikis: string[];
  dataUntil: string | null;
  skippedPages: number;
  costUsd: number;
  items: unknown[];
};

export type DigestRow = {
  id: string;
  generated_at: Date;
  hours: number;
  wikis: string[];
  data_until: Date | null;
  skipped_pages: number;
  cost_usd: string;
  items: unknown[];
};

@Injectable()
export class DigestRepository {
  constructor(@Inject(DB_POOL) private readonly pool: Pool) {}

  async save(digest: DigestCreate) {
    await this.pool.query(
      `
      INSERT INTO digests (generated_at, hours, wikis, data_until, skipped_pages, cost_usd, items)
      VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
      RETURNING id
      `,
      [
        digest.generatedAt,
        digest.hours,
        digest.wikis,
        digest.dataUntil,
        digest.skippedPages,
        digest.costUsd,
        JSON.stringify(digest.items),
      ],
    );
  }

  async findLatest(): Promise<DigestRow | null> {
    const result = await this.pool.query(
      `SELECT * FROM digests ORDER BY generated_at DESC LIMIT 1`,
    );

    return result.rows[0] ?? null;
  }
}
