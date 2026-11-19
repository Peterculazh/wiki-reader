import { Controller, Get, Query, StreamableFile } from '@nestjs/common';
import { REPORT_RANGES, StatsService } from '../domain/stats.service.js';
import { EditsReportQueryDTO } from './dto/editsReportQuery.js';
import { toCsv } from '../domain/toCsv.js';

@Controller()
export class StatsController {
  constructor(private readonly statsService: StatsService) {}

  @Get('reports/edits.csv')
  async getReport(@Query() query: EditsReportQueryDTO) {
    const { unit, count } = REPORT_RANGES[query.range];
    const rows = await this.statsService.getReport(unit, count);
    const date = new Date().toISOString().slice(0, 10);

    return new StreamableFile(Buffer.from(toCsv(rows)), {
      type: 'text/csv; charset=utf-8',
      disposition: `attachment; filename="edits-${query.range}-${date}.csv"`,
    });
  }
}
