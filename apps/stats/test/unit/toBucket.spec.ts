import { makeReportRow } from '../fixtures.js';
import { toBuckets } from '../../src/api/toBucket.js';

describe('toBucket: POSITIVE', () => {
  it('Should bucket mapped', () => {
    const date = new Date();
    const row = makeReportRow({ period_start: date });
    const result = toBuckets([row]);
    const firstRow = result[0];
    expect(firstRow.periodStart).toEqual(date.toISOString());
    expect(firstRow.final).toEqual(row.final);
  });
});
