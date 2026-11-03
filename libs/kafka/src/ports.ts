// Ports the apps depend on. Abstract classes double as Nest injection tokens,
// so a service just declares `constructor(private producer: MessageProducer)`.
// Nothing here leaks KafkaJS types: apps and their tests never import the client.

export type OutgoingMessage = {
  key?: string;
  value: string | null;
  headers?: Record<string, string>;
};

export type IncomingMessage = {
  topic: string;
  partition: number;
  offset: string;
  key: string | null;
  value: string | null;
  headers: Record<string, string>;
};

export abstract class MessageProducer {
  abstract send(topic: string, messages: OutgoingMessage[]): Promise<void>;
}

/**
 * Receives one chunk from a single topic-partition, in offset order.
 * Resolving commits the chunk; throwing leaves it uncommitted and the partition
 * is rewound to the chunk start, so the same messages are redelivered.
 */
export type BatchHandler = (messages: IncomingMessage[]) => Promise<void>;

export type SubscribeOptions = {
  groupId: string;
  topics: string[];
  /** Where a group with no committed offsets starts. Defaults to false (live only). */
  fromBeginning?: boolean;
  /**
   * Buffer each partition in memory and call the handler with exactly this many
   * messages. Unset: the handler gets whatever the client fetched.
   */
  batchSize?: number;
  /**
   * With `batchSize`: flush a partial chunk this long after its first message
   * arrived, so a quiet partition still gets committed.
   */
  maxWaitMs?: number;
};

/** Handle for one consumer-group member. Stopping drops uncommitted buffers and leaves the group. */
export type Subscription = {
  stop(): Promise<void>;
};

export type TopicPartition = { topic: string; partition: number };
export type MessagePosition = Pick<
  IncomingMessage,
  'topic' | 'partition' | 'offset'
>;

/** Offset control for `subscribeEach`, where the app decides what is committed. */
export type MessageContext = {
  /** Commits everything up to and including `message` on its partition. */
  commit(message: MessagePosition): Promise<void>;
  /**
   * Re-reads `message`'s partition starting at `message.offset`, e.g. after a
   * failed write of a buffer that started there. Messages already fetched past
   * it are not delivered again until the rewound ones are.
   */
  rewind(message: MessagePosition): void;
};

/**
 * Receives every message, one at a time and in offset order per partition.
 * Nothing is committed automatically unless `autoCommit` is set. Throwing
 * redelivers this same message.
 */
export type MessageHandler = (
  message: IncomingMessage,
  context: MessageContext,
) => Promise<void>;

export type SubscribeEachOptions = Omit<
  SubscribeOptions,
  'batchSize' | 'maxWaitMs'
> & {
  /**
   * Partitions this member no longer owns: Kafka moved them elsewhere, or the
   * subscription is stopping. Drop their buffers; the uncommitted messages are
   * read again by whoever owns the partition next.
   */
  onRevoked?(partitions: TopicPartition[]): void;
  /**
   * Let the client commit each message once the handler resolved, in the
   * background. For apps whose state lives in memory anyway, so committing
   * only after an explicit write would protect nothing. Defaults to false.
   */
  autoCommit?: boolean;
};

export type MessageSubscription = Subscription & MessageContext;

export abstract class MessageConsumerFactory {
  /** Chunked delivery: the library buffers and commits after each resolved chunk. */
  abstract subscribe(
    options: SubscribeOptions,
    handler: BatchHandler,
  ): Promise<Subscription>;

  /** Per-message delivery: the app buffers and commits with `context.commit`. */
  abstract subscribeEach(
    options: SubscribeEachOptions,
    handler: MessageHandler,
  ): Promise<MessageSubscription>;
}

export type EnsureTopicOptions = {
  numPartitions: number;
  /** Topic-level configs such as `{ 'cleanup.policy': 'compact' }`, applied on creation only */
  configs?: Record<string, string>;
};

export abstract class TopicAdmin {
  /**
   * Creates `topic` if it doesn't exist yet. An existing topic is left as is,
   * even if its partition count or configs differ, so calling this on every
   * start is safe.
   */
  abstract ensureTopic(
    topic: string,
    options: EnsureTopicOptions,
  ): Promise<void>;
}

export abstract class CompactedTopicReader {
  /**
   * Last value per key across all partitions, read up to the end offsets at call time.
   * Keyless records are skipped and tombstones (null value) remove the key.
   */
  abstract readAll(
    topic: string,
    options?: { timeoutMs?: number },
  ): Promise<Map<string, string>>;
}
