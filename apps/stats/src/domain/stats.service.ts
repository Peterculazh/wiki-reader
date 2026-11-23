import {
  IncomingMessage,
  MessageConsumerFactory,
  SubscribeOptions,
  Subscription,
} from '@app/kafka';

import {
  Inject,
  Injectable,
  OnModuleDestroy,
  OnModuleInit,
  Optional,
} from '@nestjs/common';
import { ChangeCreate, ChangesRepository } from './changes.repository.js';
import { toChangeCreate } from './to-change.js';

export const REPORT_RANGES = {
  '24h': { unit: 'hour', count: 24 },
  '7d': { unit: 'day', count: 7 },
} as const;

export type ReportRange = keyof typeof REPORT_RANGES; // '24h' | '7d'

export type ChunkingOptions = Pick<SubscribeOptions, 'batchSize' | 'maxWaitMs'>;

/**
 * Up to 500 changes share one INSERT and one offset commit. A chunk that does
 * not fill up (live traffic) is stored at most 1 s after its first message.
 */
export const DEFAULT_CHUNKING: ChunkingOptions = {
  batchSize: 500,
  maxWaitMs: 1_000,
};

/** Optional provider that replaces DEFAULT_CHUNKING. */
export const STATS_CHUNKING = Symbol('STATS_CHUNKING');

@Injectable()
export class StatsService implements OnModuleInit, OnModuleDestroy {
  private subscription: Subscription;
  private storedCount: number;
  private storedCountInterval: NodeJS.Timeout;

  constructor(
    private readonly consumers: MessageConsumerFactory,
    private readonly changesRepo: ChangesRepository,
    @Optional()
    @Inject(STATS_CHUNKING)
    private readonly chunking: ChunkingOptions = DEFAULT_CHUNKING,
  ) {}

  async onModuleInit() {
    this.storedCount = 0;
    this.storedCountInterval = setInterval(() => {
      console.log(`Stored changes ${this.storedCount}`);
      this.storedCount = 0;
    }, 10_000);

    // The library commits a chunk only after storeChunk resolved. If it throws,
    // the whole chunk is redelivered, and ON CONFLICT skips what was stored
    this.subscription = await this.consumers.subscribe(
      {
        groupId: 'stats',
        topics: ['wiki.changes'],
        fromBeginning: false,
        ...this.chunking,
      },
      (messages) => this.storeChunk(messages),
    );
  }

  private async storeChunk(messages: IncomingMessage[]) {
    const changes: ChangeCreate[] = [];
    for (const message of messages) {
      const change = toChangeCreate(message.value, (warning) => {
        console.warn(warning);
      });

      if (!change) {
        console.warn(`No content in message ${message.key}`);
        continue;
      }
      changes.push(change);
    }

    if (changes.length === 0) return;

    await this.changesRepo.insertMany(changes);
    this.storedCount += changes.length;
  }

  async onModuleDestroy() {
    await this.subscription?.stop();
    clearInterval(this.storedCountInterval);
  }

  getReport(unit: 'day' | 'hour', count: number) {
    return this.changesRepo.getReportByBucket(unit, count);
  }

  getTopPages(hours: number = 1, limit: number = 50, wiki?: string) {
    return this.changesRepo.getTopPages(hours, limit, wiki);
  }

  getPageEdits(wiki: string, title: string, hours: number, limit: number) {
    return this.changesRepo.getPageEdits(wiki, title, hours, limit);
  }

  getDataStatus() {
    return this.changesRepo.getDataStatus();
  }
}
