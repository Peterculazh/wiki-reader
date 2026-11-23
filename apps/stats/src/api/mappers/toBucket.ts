import { ChangesReportRow } from '../../domain/changes.repository.js';

export type EditsReportBucket = {
  periodStart: string;
  edits: number;
  botEdits: number;
  botShare: number | null;
  bytesDelta: number;
  final: boolean;
};

export function toBuckets(rows: ChangesReportRow[]): EditsReportBucket[] {
  return rows.map((row) => ({
    botEdits: Number(row.bot_edits),
    botShare: row.bot_share ? Number(row.bot_share) : null,
    bytesDelta: Number(row.bytes_delta),
    edits: Number(row.edits),
    final: row.final,
    periodStart: row.period_start.toISOString(),
  }));
}
