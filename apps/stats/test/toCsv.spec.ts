import { makeReportRow } from './fixtures.js';
import { toCsv } from '../src/domain/toCsv.js';

describe('toCSV: POSITIVE', () => {
  it('Should return CSV string', () => {
    expect(toCsv([makeReportRow()])).toBe(
      'Period start (UTC),Edit,Bot edits,Bot share,Bytes delta,Final\r\n' +
        '2026-11-19T12:00:00.000Z,3,1,0.333,120,Yes\r\n',
    );
  });

  it('Should leave bot share empty when there were no edits', () => {
    const csv = toCsv([makeReportRow({ bot_share: null })]);
    const cells = csv.split('\r\n')[1].split(',');

    expect(cells[3]).toBe('');
  });

  it('Should have final false', () => {
    const csv = toCsv([makeReportRow({ final: false })]);
    const cells = csv.split('\r\n')[1].split(',');

    expect(cells[5]).toBe('No');
  });

  it('Should have only headers since no data provided', () => {
    const csv = toCsv([]);
    const rows = csv.split('\r\n');

    expect(rows.length).toBe(2);
    expect(rows[1].length).toBe(0);
  });
});
