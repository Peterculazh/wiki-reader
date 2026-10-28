import {
  Inject,
  Injectable,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import {
  MessageConsumerFactory,
  MessageProducer,
  Subscription,
  TopicAdmin,
  WIKI_BURSTS_PARTITIONS,
  WIKI_BURSTS_TOPIC,
  WIKI_CHANGES_TOPIC,
} from '@app/kafka';
import { BurstDetector, pageKey } from './burst-detector.js';
import { BURSTS_CONFIG, type BurstsConfig } from './bursts.config.js';

const STATS_INTERVAL_MS = 60_000;

@Injectable()
export class BurstsService implements OnModuleInit, OnModuleDestroy {
  private subscription: Subscription | undefined;
  private evictTimer: NodeJS.Timeout | undefined;
  private statsTimer: NodeJS.Timeout | undefined;
  private readonly detector: BurstDetector;

  constructor(
    private readonly consumers: MessageConsumerFactory,
    private readonly producer: MessageProducer,
    private readonly topicAdmin: TopicAdmin,
    @Inject(BURSTS_CONFIG) private readonly config: BurstsConfig,
  ) {
    this.detector = new BurstDetector({
      windowMs: config.windowMs,
      minAuthors: config.minAuthors,
      cooldownMs: config.cooldownMs,
      // Live only: a backlog is still read (after the ingester or this app
      // restarts), but the bursts in it are history by now
      maxLagMs: config.maxLagMs,
      warn: (message) => console.warn(message),
    });
  }

  async onModuleInit() {
    // Auto-creation would give the topic the broker's default partition count
    await this.topicAdmin.ensureTopic(WIKI_BURSTS_TOPIC, {
      numPartitions: WIKI_BURSTS_PARTITIONS,
    });

    // wiki.changes is keyless, so one page's edits are spread over every
    // partition: run a single instance, or a page's state gets split between members.
    // Auto-commit: the detector's state lives in memory and is lost on restart
    // anyway, so committing only after processing would protect nothing.
    // Live only: replaying the topic would emit days of old bursts.
    this.subscription = await this.consumers.subscribeEach(
      {
        groupId: 'bursts',
        topics: [WIKI_CHANGES_TOPIC],
        fromBeginning: false,
        autoCommit: true,
      },
      async (message) => {
        // Never throws: one bad message must not block the partition
        const burst = this.detector.process(message.value);
        if (!burst) return;

        const key = pageKey(burst.wiki, burst.title);
        console.log(
          `Burst on ${key}: ${burst.authors} authors, ${burst.editCount} edits, ${burst.windowStart} .. ${burst.windowEnd}`,
        );
        try {
          await this.producer.send(WIKI_BURSTS_TOPIC, [
            { key, value: JSON.stringify(burst) },
          ]);
        } catch (err) {
          console.error(`Failed to publish burst ${burst.burstId}:`, err);
        }
      },
    );

    // Wall clock only schedules eviction; what gets evicted is decided by event time
    this.evictTimer = setInterval(
      () => this.detector.evict(),
      this.config.evictIntervalMs,
    );
    this.statsTimer = setInterval(() => this.logStats(), STATS_INTERVAL_MS);
  }

  private logStats() {
    const s = this.detector.stats();
    console.log(
      `Bursts stats: ${s.eventsSeen} events seen, ${s.eventsAccepted} accepted, ${s.eventsInvalid} invalid, ${s.keysTracked} keys tracked, ${s.burstsEmitted} bursts emitted, ${s.burstsStale} stale bursts skipped`,
    );
  }

  async onModuleDestroy() {
    await this.subscription?.stop();
    clearInterval(this.evictTimer);
    clearInterval(this.statsTimer);
    this.logStats();
    // The producer flushes and disconnects later, in KafkaModule's shutdown hook
  }
}
