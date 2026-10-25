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
 * Receives one batch from a single topic-partition, in offset order.
 * Resolving commits the batch; throwing leaves it uncommitted so it is redelivered.
 */
export type BatchHandler = (messages: IncomingMessage[]) => Promise<void>;

export type SubscribeOptions = {
  groupId: string;
  topics: string[];
  /** Where a group with no committed offsets starts. Defaults to false (live only). */
  fromBeginning?: boolean;
};

export type Subscription = {
  stop(): Promise<void>;
};

export abstract class MessageConsumerFactory {
  abstract subscribe(
    options: SubscribeOptions,
    handler: BatchHandler,
  ): Promise<Subscription>;
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
