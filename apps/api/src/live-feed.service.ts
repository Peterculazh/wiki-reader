import {
  Inject,
  Injectable,
  type MessageEvent,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { hostname } from 'node:os';
import {
  bufferTime,
  defer,
  filter,
  finalize,
  map,
  merge,
  type Observable,
  ReplaySubject,
  shareReplay,
  Subject,
  takeUntil,
  timer,
} from 'rxjs';
import {
  MessageConsumerFactory,
  type Subscription,
  TopicAdmin,
  WIKI_BURSTS_PARTITIONS,
  WIKI_BURSTS_TOPIC,
  WIKI_CHANGES_PARTITIONS,
  WIKI_CHANGES_TOPIC,
} from '@app/kafka';
import type {
  BurstEvent,
  LiveEdit,
  LiveStreamEventName,
  LiveStreamEvents,
  StatsSnapshot,
} from '@app/contracts';
import { API_CONFIG, type ApiConfig } from './api.config.js';
import { EditStats } from './edit-stats.js';
import { toLiveEdit } from './live-edit.js';
import { preview } from './preview.js';
import { parseBurst, RecentBursts } from './recent-bursts.js';

const LOG_INTERVAL_MS = 60_000;

/** Which edits one GET /live stream carries. An unset field doesn't filter. */
export type EditFilter = {
  wikis?: ReadonlySet<string>;
  /** true: bots only, false: humans only */
  bots?: boolean;
};

/**
 * Reads `wiki.changes` and `wiki.bursts` and serves them to the dashboard:
 * the latest bursts, rolling stats, and a live stream per browser.
 * Everything is in memory and starts empty, except the bursts, which are
 * read again from the topic on every start.
 */
@Injectable()
export class LiveFeedService implements OnModuleInit, OnModuleDestroy {
  private readonly edits = new Subject<LiveEdit>();
  private readonly newBursts = new Subject<BurstEvent>();
  // Replays, so that a stream opened while shutting down ends right away
  private readonly shutdown = new ReplaySubject<void>(1);
  private readonly editStats: EditStats;
  private readonly recentBursts: RecentBursts;
  /** One timer for all open streams; a new stream gets the latest snapshot at once */
  private readonly stats$: Observable<StatsSnapshot>;
  private subscriptions: Subscription[] = [];
  private logTimer: NodeJS.Timeout | undefined;
  private readonly counters = {
    eventsSeen: 0,
    editsAccepted: 0,
    invalid: 0,
    openStreams: 0,
  };

  constructor(
    private readonly consumers: MessageConsumerFactory,
    private readonly topicAdmin: TopicAdmin,
    @Inject(API_CONFIG) private readonly config: ApiConfig,
  ) {
    this.editStats = new EditStats({
      windowMinutes: config.statsWindowMinutes,
      topN: config.topN,
    });
    this.recentBursts = new RecentBursts(config.maxBursts);
    this.stats$ = defer(() => timer(0, config.statsIntervalMs)).pipe(
      map(() => this.editStats.snapshot()),
      shareReplay({ bufferSize: 1, refCount: true }),
    );
  }

  async onModuleInit() {
    // The ingester and bursts create these too. Creating them here as well, with
    // the same partition counts, lets the api start before them.
    await this.topicAdmin.ensureTopic(WIKI_CHANGES_TOPIC, {
      numPartitions: WIKI_CHANGES_PARTITIONS,
    });
    await this.topicAdmin.ensureTopic(WIKI_BURSTS_TOPIC, {
      numPartitions: WIKI_BURSTS_PARTITIONS,
    });

    // Fan-out, not shared work: each instance serves its own browsers, so each
    // one must see every message. Instances sharing a group would split the
    // partitions between them, and every browser would get only part of the
    // stream. Hence fresh groups on every start, like the ingester's compacted
    // reader, and no commits: nothing resumes from them, so they would only
    // leave offsets behind in __consumer_offsets. The host name (the pod's name
    // in Kubernetes) tells the groups apart in Kafka UI.
    const instance = `${hostname()}-${randomUUID().slice(0, 8)}`;

    // Live only, like bursts: a replay would show days of old edits as new
    this.subscriptions.push(
      await this.consumers.subscribeEach(
        {
          groupId: `api-edits-${instance}`,
          topics: [WIKI_CHANGES_TOPIC],
          fromBeginning: false,
        },
        async (message) => this.onChange(message.value),
      ),
    );
    // From the beginning: the topic's retention (7 days by default) refills the
    // list, so the dashboard isn't empty after a restart
    this.subscriptions.push(
      await this.consumers.subscribeEach(
        {
          groupId: `api-bursts-${instance}`,
          topics: [WIKI_BURSTS_TOPIC],
          fromBeginning: true,
        },
        async (message) => this.onBurst(message.value),
      ),
    );

    this.logTimer = setInterval(() => this.logStats(), LOG_INTERVAL_MS);
  }

  /** Up to `limit` of the latest bursts, newest first */
  bursts(limit: number): BurstEvent[] {
    return this.recentBursts.list(Math.min(limit, this.config.maxBursts));
  }

  stats(): StatsSnapshot {
    return this.editStats.snapshot();
  }

  /** What one GET /live connection receives, until it closes or the app shuts down */
  stream(editFilter: EditFilter): Observable<MessageEvent> {
    return defer(() => {
      this.counters.openStreams++;

      const edits = this.edits.pipe(
        filter((edit) => matches(edit, editFilter)),
        bufferTime(this.config.batchMs),
        filter((batch) => batch.length > 0),
        map((batch) => event('edits', batch)),
      );

      return merge(
        this.stats$.pipe(map((snapshot) => event('stats', snapshot))),
        edits,
        this.newBursts.pipe(map((burst) => event('burst', burst))),
      ).pipe(
        // Subscribes to `shutdown` first: after shutdown, the replayed value
        // ends a new stream before any of it starts
        takeUntil(this.shutdown),
        finalize(() => this.counters.openStreams--),
      );
    });
  }

  async onModuleDestroy() {
    clearInterval(this.logTimer);
    // Completes every open stream, so Nest ends those responses and the HTTP
    // server can close instead of waiting on them until the pod is killed
    this.shutdown.next();
    this.shutdown.complete();
    await Promise.all(this.subscriptions.map((s) => s.stop()));
    this.subscriptions = [];
    this.logStats();
  }

  // Both handlers never throw: one bad message must not block its partition

  private onChange(value: string | null) {
    this.counters.eventsSeen++;
    try {
      const edit = toLiveEdit(value, (message) => {
        this.counters.invalid++;
        console.warn(message);
      });
      if (!edit) return;
      this.counters.editsAccepted++;
      this.editStats.add(edit);
      this.edits.next(edit);
    } catch (err) {
      this.counters.invalid++;
      console.warn(
        `Skipping message (unexpected error ${String(err)}): ${preview(value)}`,
      );
    }
  }

  private onBurst(value: string | null) {
    const parsed = parseBurst(value);
    if ('invalid' in parsed) {
      this.counters.invalid++;
      console.warn(`Skipping burst (${parsed.invalid}): ${preview(value)}`);
      return;
    }
    if (this.recentBursts.add(parsed.burst)) this.newBursts.next(parsed.burst);
  }

  private logStats() {
    const c = this.counters;
    console.log(
      `Api stats: ${c.eventsSeen} events seen, ${c.editsAccepted} edits accepted, ${c.invalid} invalid, ${this.recentBursts.size} bursts kept, ${c.openStreams} open streams`,
    );
  }
}

function matches(edit: LiveEdit, { wikis, bots }: EditFilter): boolean {
  return (
    (wikis === undefined || wikis.has(edit.wiki)) &&
    (bots === undefined || edit.bot === bots)
  );
}

function event<K extends LiveStreamEventName>(
  type: K,
  data: LiveStreamEvents[K],
): MessageEvent {
  return { type, data };
}
