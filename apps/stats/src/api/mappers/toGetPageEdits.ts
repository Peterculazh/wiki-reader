import type {
  PageEditRow,
  PageEditsSummaryRow,
} from '../../domain/changes.repository.js';

export type GetPageEdits = {
  wiki: string;
  title: string;
  hours: number;
  summary: {
    edits: number;
    authors: number;
    botEdits: number;
    bytesDelta: number;
  };
  edits: {
    time: string;
    author: string;
    bot: boolean;
    type: string;
    bytesDelta: number | null;
  }[];
};

export function toGetPageEdits(
  wiki: string,
  title: string,
  hours: number,
  summary: PageEditsSummaryRow,
  edits: PageEditRow[],
): GetPageEdits {
  return {
    wiki,
    title,
    hours,
    summary: {
      authors: Number(summary.authors),
      botEdits: Number(summary.bot_edits),
      bytesDelta: Number(summary.bytes_delta),
      edits: Number(summary.edits),
    },
    edits: edits.map((item) => ({
      author: item.author,
      bot: item.bot,
      bytesDelta: item.bytes_delta,
      time: item.event_time.toISOString(),
      type: item.type,
    })),
  };
}
