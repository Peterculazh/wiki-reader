import { Controller, Get, Query, StreamableFile } from '@nestjs/common';
import { REPORT_RANGES, StatsService } from '../domain/stats.service.js';
import { EditsReportQueryDTO } from './dto/editsReportQuery.js';
import { toCsv } from '../domain/toCsv.js';
import { toBuckets } from './mappers/toBucket.js';
import { TopPagesQueryDTO } from './dto/topPagesQuery.js';
import { toTopPages } from './mappers/toTopPages.js';
import { GetPageEditsQueryDTO } from './dto/getPageEdits.js';
import { toGetPageEdits } from './mappers/toGetPageEdits.js';
import { toDataStatus } from './mappers/toDataStatus.js';

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

  @Get('reports/edits')
  async getEdits(@Query() query: EditsReportQueryDTO) {
    const { unit, count } = REPORT_RANGES[query.range];
    const rows = await this.statsService.getReport(unit, count);

    return {
      range: query.range,
      unit,
      buckets: toBuckets(rows),
    };
  }

  @Get('reports/top-pages')
  async getTopPages(@Query() query: TopPagesQueryDTO) {
    const rows = await this.statsService.getTopPages(
      query.hours,
      query.limit,
      query.wiki,
    );

    return {
      hours: query.hours,
      wiki: query.wiki ?? null,
      pages: toTopPages(rows),
    };
  }

  @Get('reports/page-edits')
  async getPageEdits(@Query() query: GetPageEditsQueryDTO) {
    const { wiki, title, hours, limit } = query;
    const { edits, summary } = await this.statsService.getPageEdits(
      wiki,
      title,
      hours,
      limit,
    );

    return toGetPageEdits(wiki, title, hours, summary, edits);
  }

  @Get('reports/status')
  async getStatus() {
    const result = await this.statsService.getDataStatus();

    return toDataStatus(result);
  }
}
