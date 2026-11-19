import { MessageConsumerFactory, Subscription } from '@app/kafka';

import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ChangesRepository } from './changes.repository.js';
import { toChangeCreate } from './to-change.js';

export const REPORT_RANGES = {
  '24h': { unit: 'hour', count: 24 },
  '7d': { unit: 'day', count: 7 },
} as const;

export type ReportRange = keyof typeof REPORT_RANGES; // '24h' | '7d'

@Injectable()
export class StatsService implements OnModuleInit, OnModuleDestroy {
  private subscription: Subscription;
  private storedCount: number;
  private storedCountInterval: NodeJS.Timeout;

  constructor(
    private readonly consumers: MessageConsumerFactory,
    private readonly changesRepo: ChangesRepository,
  ) {}

  async onModuleInit() {
    this.storedCount = 0;
    this.storedCountInterval = setInterval(() => {
      console.log(`Stored changes ${this.storedCount}`);
      this.storedCount = 0;
    }, 10_000);

    this.subscription = await this.consumers.subscribeEach(
      {
        groupId: 'stats',
        topics: ['wiki.changes'],
        fromBeginning: false,
      },
      async (message) => {
        const change = toChangeCreate(message.value, (message) => {
          console.warn(message);
        });

        if (!change) {
          console.warn(`No content in message ${message.key}`);
          return;
        }

        await this.changesRepo.insert(change);
        this.storedCount++;
      },
    );
  }

  async onModuleDestroy() {
    await this.subscription?.stop();
    clearInterval(this.storedCountInterval);
  }

  async getReport(unit: 'day' | 'hour', count: number) {
    const rows = await this.changesRepo.getReportByBucket(unit, count);

    return rows;
  }
}
