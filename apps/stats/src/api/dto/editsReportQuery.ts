import { IsIn } from 'class-validator';
import { REPORT_RANGES, type ReportRange } from '../../domain/stats.service.js';

export class EditsReportQueryDTO {
  @IsIn(Object.keys(REPORT_RANGES))
  range: ReportRange;
}
