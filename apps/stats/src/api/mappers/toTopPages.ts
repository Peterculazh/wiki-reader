import type { TopPageRow } from '../../domain/changes.repository.js';

export type TopPage = {
  wiki: string;
  title: string;
  edits: number;
  botEdits: number;
  authors: number;
};

export function toTopPages(rows: TopPageRow[]): TopPage[] {
  return rows.map((row) => ({
    wiki: row.wiki,
    title: row.title,
    edits: Number(row.edits),
    botEdits: Number(row.bot_edits),
    authors: Number(row.authors),
  }));
}
