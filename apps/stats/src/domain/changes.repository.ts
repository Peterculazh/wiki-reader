import { Inject, Injectable } from '@nestjs/common';
import type { Pool } from 'pg';
import { DB_POOL } from '@app/postgres';

export type ChangeCreate = {
  eventId: string;
  eventTime: string;
  wiki: string;
  title: string;
  type: string;
  author: string;
  namespace: number;
  bot: boolean;
  length_old: number | undefined;
  length_new: number | undefined;
};

export type Change = {
  id: string;
  eventId: string;
  eventTime: string;
  wiki: string;
  title: string;
  type: string;
  author: string;
  namespace: number;
  bot: boolean;
  length_old: number | undefined;
  length_new: number | undefined;
};

export type ChangesReportRow = {
  period_start: Date;
  edits: string; // count(*) → bigint → '2328334'
  bot_edits: string;
  bot_share: string | null; // numeric; null, коли правок 0
  bytes_delta: string; // sum(int) → bigint
  final: boolean;
};

@Injectable()
export class ChangesRepository {
  constructor(@Inject(DB_POOL) private readonly pool: Pool) {}

  async insert(change: ChangeCreate): Promise<void> {
    await this.pool.query(
      `INSERT INTO changes (event_id, event_time, wiki, title, type, author, namespace, bot, length_old, length_new)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       ON CONFLICT (event_id) DO NOTHING`,
      [
        change.eventId,
        change.eventTime,
        change.wiki,
        change.title,
        change.type,
        change.author,
        change.namespace,
        change.bot,
        change.length_old,
        change.length_new,
      ],
    );
  }

  async getReportByBucket(unit: 'hour' | 'day', count: number) {
    const result = await this.pool.query<ChangesReportRow>(
      `
      WITH
    BUCKETS AS (
        SELECT
            GENERATE_SERIES(
                DATE_SUBTRACT(DATE_TRUNC($1, NOW(), 'UTC'), ($2 - 1) * ('1 ' || $1)::INTERVAL, 'UTC'),
                DATE_TRUNC($1, NOW(), 'UTC'),
                ('1 ' || $1)::INTERVAL,
                'UTC'
            ) AS PERIOD_START
    ),
    COUNTS AS (
        SELECT
            COUNT(*) AS EDITS,
            DATE_TRUNC($1, EVENT_TIME, 'UTC') AS PERIOD_START,
            COUNT(*) FILTER (WHERE BOT) AS BOT_EDITS,
            SUM(LENGTH_NEW - COALESCE(LENGTH_OLD, 0)) AS BYTES_DELTA
        FROM
            CHANGES
        WHERE
            TYPE IN ('edit', 'new')
            AND EVENT_TIME >= DATE_SUBTRACT(DATE_TRUNC($1, NOW(), 'UTC'), ($2 - 1) * ('1 ' || $1)::INTERVAL, 'UTC')
        GROUP BY
            PERIOD_START
    )
SELECT
    PERIOD_START,
    COALESCE(EDITS, 0) AS EDITS,
    COALESCE(BOT_EDITS, 0) AS BOT_EDITS,
    ROUND(BOT_EDITS::NUMERIC / NULLIF(EDITS, 0), 3) AS BOT_SHARE,
    COALESCE(BYTES_DELTA, 0) AS BYTES_DELTA,
    (
        DATE_ADD(PERIOD_START, ('1 ' || $1)::INTERVAL, 'UTC') <= NOW() - INTERVAL '3 hours'
    ) AS FINAL
FROM
    BUCKETS
    LEFT JOIN COUNTS USING (PERIOD_START)
ORDER BY
    PERIOD_START;
      `,
      [unit, count],
    );

    return result.rows;
  }
}
