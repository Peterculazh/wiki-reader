import {
  BatchHandler,
  CompactedTopicReader,
  EnsureTopicOptions,
  IncomingMessage,
  MessageConsumerFactory,
  MessageContext,
  MessageHandler,
  MessageProducer,
  MessageSubscription,
  OutgoingMessage,
  SubscribeEachOptions,
  SubscribeOptions,
  Subscription,
  TopicAdmin,
} from '../ports.js';
import { PartitionChunker } from '../partition-chunker.js';

type TopicCursor = {
  /** Next offset to fetch; may run ahead of the committed offset while the app buffers. */
  position: number;
  /** Bumped on every rewind, so an in-progress delivery stops at the old position. */
  generation: number;
  deliver(batch: IncomingMessage[]): Promise<void>;
  idle(): Promise<void>;
  /** Partition taken away: forget buffered state. */
  revoke(): void;
};

type ActiveSubscription = {
  groupId: string;
  cursors: Map<string, TopicCursor>;
  stopped: boolean;
  // Serializes fetches so a subscription sees one batch at a time
  chain: Promise<void>;
  onRevoked?: SubscribeEachOptions['onRevoked'];
};

/**
 * In-process stand-in for every Kafka port. Each topic has a single partition (0).
 *
 * Delivery to subscribers is asynchronous like the real client: `send` resolves
 * once the message is stored, and `drain()` waits until every subscriber has
 * caught up. Chunking (`batchSize` / `maxWaitMs`) uses the same PartitionChunker
 * as the real consumer. A throwing handler leaves its chunk or message
 * uncommitted; it is retried on the next `send` or `drain`, and the error is
 * kept in `handlerErrors`.
 */
export class InMemoryKafka
  implements
    MessageProducer,
    MessageConsumerFactory,
    CompactedTopicReader,
    TopicAdmin
{
  private readonly log = new Map<string, IncomingMessage[]>();
  /** groupId -> topic -> next offset to deliver */
  private readonly committed = new Map<string, Map<string, number>>();
  private readonly subscriptions = new Set<ActiveSubscription>();
  private readonly sendFailures: Error[] = [];
  /** topic -> requested partition count; delivery still uses partition 0 only */
  private readonly ensured = new Map<string, number>();
  /** topic -> configs it was created with (stored only, not enforced) */
  private readonly ensuredConfigs = new Map<string, Record<string, string>>();

  readonly handlerErrors: unknown[] = [];

  // --- MessageProducer ---

  async send(topic: string, messages: OutgoingMessage[]): Promise<void> {
    const failure = this.sendFailures.shift();
    if (failure) throw failure;

    const entries = this.topicLog(topic);
    for (const message of messages) {
      entries.push({
        topic,
        partition: 0,
        offset: String(entries.length),
        key: message.key ?? null,
        value: message.value,
        headers: { ...message.headers },
      });
    }
    this.pumpAll();
  }

  // --- MessageConsumerFactory ---

  async subscribe(
    {
      groupId,
      topics,
      fromBeginning = false,
      batchSize,
      maxWaitMs,
    }: SubscribeOptions,
    handler: BatchHandler,
  ): Promise<Subscription> {
    const committed = this.groupOffsets(groupId, topics, fromBeginning);

    const subscription = this.register(groupId, topics, (topic) => {
      const newChunker = () =>
        new PartitionChunker(
          { batchSize, maxWaitMs },
          {
            flush: async (chunk) => {
              await handler(chunk);
              committed.set(topic, Number(chunk[chunk.length - 1].offset) + 1);
            },
            rewind: (offset) => this.rewind(subscription, topic, offset),
            onError: (err) => this.handlerErrors.push(err),
          },
        );
      let chunker = newChunker();
      return {
        deliver: (batch) => chunker.push(batch),
        idle: () => chunker.idle(),
        revoke: () => {
          chunker.drop();
          chunker = newChunker();
        },
      };
    });

    return { stop: () => this.stop(subscription) };
  }

  async subscribeEach(
    {
      groupId,
      topics,
      fromBeginning = false,
      onRevoked,
      autoCommit = false,
    }: SubscribeEachOptions,
    handler: MessageHandler,
  ): Promise<MessageSubscription> {
    const committed = this.groupOffsets(groupId, topics, fromBeginning);

    const context: MessageContext = {
      commit: async ({ topic, offset }) => {
        if (!subscription.stopped) committed.set(topic, Number(offset) + 1);
      },
      rewind: ({ topic, offset }) => {
        this.rewind(subscription, topic, offset);
        // The real client re-fetches by itself after a seek
        this.pump(subscription);
      },
    };

    const subscription = this.register(groupId, topics, (topic) => ({
      deliver: async (batch) => {
        const cursor = subscription.cursors.get(topic)!;
        const generation = cursor.generation;
        for (const message of batch) {
          if (subscription.stopped || cursor.generation !== generation) return;
          try {
            await handler(message, context);
            // The real client commits stored offsets later, in the background
            if (autoCommit) await context.commit(message);
          } catch (err) {
            this.handlerErrors.push(err);
            if (cursor.generation === generation) {
              this.rewind(subscription, topic, message.offset);
            }
            return;
          }
        }
      },
      idle: async () => {},
      revoke: () => {},
    }));
    subscription.onRevoked = onRevoked;

    return { stop: () => this.stop(subscription), ...context };
  }

  // --- TopicAdmin ---

  async ensureTopic(
    topic: string,
    { numPartitions, configs = {} }: EnsureTopicOptions,
  ): Promise<void> {
    if (this.ensured.has(topic)) return;
    this.ensured.set(topic, numPartitions);
    this.ensuredConfigs.set(topic, { ...configs });
  }

  // --- CompactedTopicReader ---

  async readAll(topic: string): Promise<Map<string, string>> {
    const values = new Map<string, string>();
    for (const { key, value } of this.topicLog(topic)) {
      if (key === null) continue;
      if (value === null) values.delete(key);
      else values.set(key, value);
    }
    return values;
  }

  // --- Test helpers ---

  /** Every message stored on `topic`, in offset order. */
  sent(topic: string): IncomingMessage[] {
    return [...this.topicLog(topic)];
  }

  /** Topics created through `ensureTopic`, with the partition count they were created with. */
  topics(): Map<string, number> {
    return new Map(this.ensured);
  }

  /** Configs `topic` was created with through `ensureTopic`, or undefined if it never was. */
  topicConfigs(topic: string): Record<string, string> | undefined {
    const configs = this.ensuredConfigs.get(topic);
    return configs && { ...configs };
  }

  /** Makes the next `send` call reject with `error` without storing anything. */
  failNextSend(error: Error = new Error('InMemoryKafka: send failed')): void {
    this.sendFailures.push(error);
  }

  /**
   * Waits until every active subscription has fetched all stored messages and
   * flushed every full chunk (or failed). Partial chunks stay buffered until
   * their `maxWaitMs` timer fires.
   */
  async drain(): Promise<void> {
    this.pumpAll();
    await Promise.all(
      [...this.subscriptions].map(async (s) => {
        await s.chain;
        await Promise.all([...s.cursors.values()].map((c) => c.idle()));
      }),
    );
  }

  /**
   * Simulates a rebalance that takes every partition away and hands it straight
   * back: buffers are dropped, `onRevoked` fires, and delivery resumes from the
   * committed offsets.
   */
  async rebalance(): Promise<void> {
    for (const subscription of this.subscriptions) this.revokeAll(subscription);
    await this.drain();
  }

  private register(
    groupId: string,
    topics: string[],
    makeCursor: (topic: string) => Omit<TopicCursor, 'position' | 'generation'>,
  ): ActiveSubscription {
    const committed = this.committed.get(groupId)!;
    const subscription: ActiveSubscription = {
      groupId,
      cursors: new Map(),
      stopped: false,
      chain: Promise.resolve(),
    };
    for (const topic of topics) {
      subscription.cursors.set(topic, {
        position: committed.get(topic)!,
        generation: 0,
        ...makeCursor(topic),
      });
    }
    this.subscriptions.add(subscription);
    this.pump(subscription);
    return subscription;
  }

  private async stop(subscription: ActiveSubscription) {
    if (subscription.stopped) return;
    this.revokeAll(subscription);
    subscription.stopped = true;
    this.subscriptions.delete(subscription);
    await subscription.chain;
  }

  private revokeAll(subscription: ActiveSubscription) {
    const committed = this.committed.get(subscription.groupId)!;
    for (const [topic, cursor] of subscription.cursors) {
      cursor.revoke();
      this.rewind(subscription, topic, String(committed.get(topic) ?? 0));
    }
    subscription.onRevoked?.(
      [...subscription.cursors.keys()].map((topic) => ({
        topic,
        partition: 0,
      })),
    );
  }

  private rewind(
    subscription: ActiveSubscription,
    topic: string,
    offset: string,
  ) {
    const cursor = subscription.cursors.get(topic);
    if (!cursor) return;
    cursor.position = Number(offset);
    cursor.generation++;
  }

  private pumpAll() {
    for (const subscription of this.subscriptions) this.pump(subscription);
  }

  private pump(subscription: ActiveSubscription) {
    subscription.chain = subscription.chain.then(() =>
      this.deliver(subscription),
    );
  }

  private async deliver(subscription: ActiveSubscription) {
    for (const [topic, cursor] of subscription.cursors) {
      if (subscription.stopped) return;

      const batch = this.topicLog(topic).slice(cursor.position);
      if (batch.length === 0) continue;

      cursor.position += batch.length;
      await cursor.deliver(batch);
    }
  }

  private topicLog(topic: string): IncomingMessage[] {
    let entries = this.log.get(topic);
    if (!entries) {
      entries = [];
      this.log.set(topic, entries);
    }
    return entries;
  }

  /** Committed offsets of `groupId`, starting new topics like a fresh group would. */
  private groupOffsets(
    groupId: string,
    topics: string[],
    fromBeginning: boolean,
  ): Map<string, number> {
    let offsets = this.committed.get(groupId);
    if (!offsets) {
      offsets = new Map();
      this.committed.set(groupId, offsets);
    }
    for (const topic of topics) {
      if (!offsets.has(topic)) {
        offsets.set(topic, fromBeginning ? 0 : this.topicLog(topic).length);
      }
    }
    return offsets;
  }
}
