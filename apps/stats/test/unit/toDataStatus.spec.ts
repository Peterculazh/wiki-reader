import { toDataStatus } from '../../src/api/mappers/toDataStatus.js';

describe('toDataStatus', () => {
  it('Should map the row to camelCase with an ISO date', () => {
    expect(
      toDataStatus({
        data_until: new Date('2026-11-23T07:14:51.819Z'),
        minutes_behind: 366,
      }),
    ).toEqual({ dataUntil: '2026-11-23T07:14:51.819Z', minutesBehind: 366 });
  });

  it('Should keep nulls when there is no data', () => {
    expect(toDataStatus({ data_until: null, minutes_behind: null })).toEqual({
      dataUntil: null,
      minutesBehind: null,
    });
  });
});
