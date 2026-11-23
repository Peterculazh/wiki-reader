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
  edits: string;
  bot_edits: string;
  bot_share: string | null;
  bytes_delta: string;
  final: boolean;
};

export type TopPageRow = {
  wiki: string;
  title: string;
  edits: string;
  bot_edits: string;
  authors: string;
};

export type PageEditsSummaryRow = {
  edits: string;
  authors: string;
  bot_edits: string;
  bytes_delta: string;
};

export type PageEditRow = {
  event_time: Date;
  author: string;
  bot: boolean;
  type: string;
  bytes_delta: number | null;
};

export type DataStatusRow = {
  data_until: Date | null;
  minutes_behind: number | null;
};

@Injectable()
export class ChangesRepository {
  constructor(@Inject(DB_POOL) private readonly pool: Pool) {}

  async insert(change: ChangeCreate): Promise<void> {
    await this.insertMany([change]);
  }

  async insertMany(changes: ChangeCreate[]): Promise<void> {
    if (changes.length === 0) return;

    await this.pool.query(
      `INSERT INTO changes (event_id, event_time, wiki, title, type, author, namespace, bot, length_old, length_new)
       SELECT * FROM unnest(
         $1::uuid[], $2::timestamptz[], $3::text[], $4::text[], $5::text[],
         $6::text[], $7::int[], $8::boolean[], $9::int[], $10::int[]
       )
       ON CONFLICT (event_id) DO NOTHING`,
      [
        changes.map((change) => change.eventId),
        changes.map((change) => change.eventTime),
        changes.map((change) => change.wiki),
        changes.map((change) => change.title),
        changes.map((change) => change.type),
        changes.map((change) => change.author),
        changes.map((change) => change.namespace),
        changes.map((change) => change.bot),
        changes.map((change) => change.length_old ?? null),
        changes.map((change) => change.length_new ?? null),
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

  async getTopPages(
    hours: number,
    limit: number,
    wiki?: string,
  ): Promise<TopPageRow[]> {
    const result = await this.pool.query<TopPageRow>(
      `SELECT wiki,
            title,
            count(*) AS edits,
            count(*) FILTER (WHERE bot) AS bot_edits,
            count(DISTINCT author) AS authors
       FROM changes
      WHERE type IN ('edit', 'new')
        AND namespace = 0
        AND event_time >= now() - make_interval(hours => $1)
        AND ($3::text IS NULL OR wiki = $3)
      GROUP BY wiki, title
      ORDER BY edits DESC, title
      LIMIT $2`,
      [hours, limit, wiki ?? null],
    );
    return result.rows;
  }

  async getPageEdits(
    wiki: string,
    title: string,
    hours: number,
    limit: number,
  ) {
    const SUMMARY_SQL = `SELECT count(*)                    AS edits,
       count(DISTINCT author)      AS authors,
       count(*) FILTER (WHERE bot) AS bot_edits,
       COALESCE(sum(length_new - COALESCE(length_old, 0)), 0) AS bytes_delta
  FROM changes
 WHERE wiki = $1
   AND title = $2
   AND type IN ('edit', 'new')
   AND event_time >= now() - make_interval(hours => $3)`;
    const EDITS_SQL = `SELECT event_time,
       author,
       bot,
       type,
       length_new - COALESCE(length_old, 0) AS bytes_delta
  FROM changes
 WHERE wiki = $1
   AND title = $2
   AND type IN ('edit', 'new')
   AND event_time >= now() - make_interval(hours => $3)
 ORDER BY event_time DESC
 LIMIT $4`;

    const [summary, edits] = await Promise.all([
      this.pool.query<PageEditsSummaryRow>(SUMMARY_SQL, [wiki, title, hours]),
      this.pool.query<PageEditRow>(EDITS_SQL, [wiki, title, hours, limit]),
    ]);
    return { summary: summary.rows[0], edits: edits.rows };
  }

  async getDataStatus() {
    const result = await this.pool.query<DataStatusRow>(
      `SELECT max(event_time) AS data_until,
       floor(extract(epoch FROM now() - max(event_time)) / 60)::int AS minutes_behind
  FROM changes`,
    );
    return result.rows[0];
  }
}
