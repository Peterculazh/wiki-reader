import { IsIn } from 'class-validator';
import { REPORT_RANGES, type ReportRange } from '../../stats.service.js';

export const REPORT_RANGES = {
  '24h': { unit: 'hour', count: 24 },
  '7d': { unit: 'day', count: 7 },
} as const;

export type ReportRange = keyof typeof REPORT_RANGES; // '24h' | '7d'

export class EditsReportQueryDTO {
  @IsIn(Object.keys(REPORT_RANGES))
  range: ReportRange;
}
