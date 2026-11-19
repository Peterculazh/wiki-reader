import {
  BadRequestException,
  Controller,
  DefaultValuePipe,
  Get,
  type MessageEvent,
  ParseIntPipe,
  Query,
  Sse,
} from '@nestjs/common';
import type { Observable } from 'rxjs';
import type { BurstEvent, StatsSnapshot } from '@app/contracts';
import { type EditFilter, LiveFeedService } from './live-feed.service.js';

@Controller()
export class LiveController {
  constructor(private readonly feed: LiveFeedService) {}

  /** The latest bursts, newest first. `?limit=` 1 to 100, default 50. */
  @Get('bursts')
  bursts(
    @Query('limit', new DefaultValuePipe(50), ParseIntPipe) limit: number,
  ): BurstEvent[] {
    if (limit < 1) throw new BadRequestException('limit must be at least 1');
    return this.feed.bursts(limit);
  }

  @Get('stats')
  stats(): StatsSnapshot {
    return this.feed.stats();
  }

  /**
   * Server-sent events, typed by `LiveStreamEvents`: `stats` right away and
   * every few seconds, `edits` in batches, `burst` for each new burst. The
   * filters apply to `edits` only: `?wiki=enwiki,dewiki` and `?bots=false`.
   */
  @Sse('live')
  live(
    @Query('wiki') wiki?: string | string[],
    @Query('bots') bots?: string,
  ): Observable<MessageEvent> {
    return this.feed.stream(parseEditFilter(wiki, bots));
  }
}

export function parseEditFilter(
  wiki: string | string[] | undefined,
  bots: string | undefined,
): EditFilter {
  if (bots !== undefined && bots !== 'true' && bots !== 'false') {
    throw new BadRequestException('bots must be true or false');
  }
  // `?wiki=a,b` and `?wiki=a&wiki=b` both work
  const wikis = [wiki ?? []]
    .flat()
    .flatMap((value) => value.split(','))
    .map((value) => value.trim())
    .filter((value) => value.length > 0);

  return {
    wikis: wikis.length > 0 ? new Set(wikis) : undefined,
    bots: bots === undefined ? undefined : bots === 'true',
  };
}
