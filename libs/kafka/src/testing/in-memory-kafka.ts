import {
  BatchHandler,
  CompactedTopicReader,
  IncomingMessage,
  MessageConsumerFactory,
  MessageProducer,
  OutgoingMessage,
  SubscribeOptions,
  Subscription,
} from '../ports.js';

type ActiveSubscription = {
  groupId: string;
  topics: string[];
  handler: BatchHandler;
  stopped: boolean;
  // Serializes deliveries so a subscription sees one batch at a time
  chain: Promise<void>;
};

/**
 * In-process stand-in for every Kafka port. Each topic has a single partition (0).
 *
 * Delivery to subscribers is asynchronous like the real client: `send` resolves
 * once the message is stored, and `drain()` waits until every subscriber has
 * caught up. A throwing handler leaves its batch uncommitted; it is retried on
 * the next `send` or `drain`, and the last error is kept in `handlerErrors`.
 */
export class InMemoryKafka
  implements MessageProducer, MessageConsumerFactory, CompactedTopicReader
{
  private readonly log = new Map<string, IncomingMessage[]>();
  /** groupId -> topic -> next offset to deliver */
  private readonly committed = new Map<string, Map<string, number>>();
  private readonly subscriptions = new Set<ActiveSubscription>();
  private readonly sendFailures: Error[] = [];

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
    { groupId, topics, fromBeginning = false }: SubscribeOptions,
    handler: BatchHandler,
  ): Promise<Subscription> {
    const offsets = this.groupOffsets(groupId);
    for (const topic of topics) {
      if (!offsets.has(topic)) {
        offsets.set(topic, fromBeginning ? 0 : this.topicLog(topic).length);
      }
    }

    const subscription: ActiveSubscription = {
      groupId,
      topics,
      handler,
      stopped: false,
      chain: Promise.resolve(),
    };
    this.subscriptions.add(subscription);
    this.pump(subscription);

    return {
      stop: async () => {
        subscription.stopped = true;
        this.subscriptions.delete(subscription);
        await subscription.chain;
      },
    };
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

  /** Makes the next `send` call reject with `error` without storing anything. */
  failNextSend(error: Error = new Error('InMemoryKafka: send failed')): void {
    this.sendFailures.push(error);
  }

  /** Waits until every active subscription has processed all stored messages (or failed). */
  async drain(): Promise<void> {
    this.pumpAll();
    await Promise.all([...this.subscriptions].map((s) => s.chain));
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
    const offsets = this.groupOffsets(subscription.groupId);
    for (const topic of subscription.topics) {
      if (subscription.stopped) return;

      const next = offsets.get(topic) ?? 0;
      const batch = this.topicLog(topic).slice(next);
      if (batch.length === 0) continue;

      try {
        await subscription.handler(batch);
        offsets.set(topic, next + batch.length);
      } catch (err) {
        this.handlerErrors.push(err);
        return;
      }
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

  private groupOffsets(groupId: string): Map<string, number> {
    let offsets = this.committed.get(groupId);
    if (!offsets) {
      offsets = new Map();
      this.committed.set(groupId, offsets);
    }
    return offsets;
  }
}
