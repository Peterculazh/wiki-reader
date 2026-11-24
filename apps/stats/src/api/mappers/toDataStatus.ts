import type { DataStatusRow } from '../../domain/changes.repository.js';

export type DataStatus = {
  dataUntil: string | null;
  minutesBehind: number | null;
};

export function toDataStatus(row: DataStatusRow): DataStatus {
  return {
    dataUntil: row.data_until?.toISOString() ?? null,
    minutesBehind:
      row.minutes_behind === null ? null : Math.max(0, row.minutes_behind),
  };
}
