import { ChangesReportRow } from './changes.repository.js';

const COLUMNS: { header: string; value: (row: ChangesReportRow) => string }[] =
  [
    {
      header: 'Period start (UTC)',
      value: (row) => row.period_start.toISOString(),
    },
    { header: 'Edit', value: (row) => row.edits },
    { header: 'Bot edits', value: (row) => row.bot_edits },
    { header: 'Bot share', value: (row) => row.bot_share ?? '' },
    { header: 'Bytes delta', value: (row) => row.bytes_delta },
    { header: 'Final', value: (row) => (row.final ? 'Yes' : 'No') },
  ];

export function toCsv(rows: ChangesReportRow[]): string {
  const lines = [
    COLUMNS.map((column) => column.header).join(','),
    ...rows.map((row) => COLUMNS.map((column) => column.value(row)).join(',')),
  ];
  return lines.join('\r\n') + '\r\n';
}
