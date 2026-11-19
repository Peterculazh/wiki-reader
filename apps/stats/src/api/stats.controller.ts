import { Controller, Get, Inject, Query } from '@nestjs/common';
import { REPORT_RANGES, StatsService } from '../stats.service.js';
import { EditsReportQueryDTO } from './dto/EditsReportQuery.js';

@Controller()
export class StatsController {
  constructor(private readonly statsService: StatsService) {}

  @Get('reports/edits')
  getReport(@Query() query: EditsReportQueryDTO) {
    const { unit, count } = REPORT_RANGES[query.range];

    return this.statsService.getReport(unit, count);
  }
}
