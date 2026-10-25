import {
  Inject,
  Injectable,
  Logger,
  OnApplicationShutdown,
} from '@nestjs/common';
import { setTimeout as sleep } from 'node:timers/promises';
import { KafkaJS } from '@confluentinc/kafka-javascript';
import { PartitionChunker } from '../partition-chunker.js';
import {
  BatchHandler,
  IncomingMessage,
  MessageConsumerFactory,
  MessageContext,
  MessageHandler,
  MessagePosition,
  MessageSubscription,
  SubscribeEachOptions,
  SubscribeOptions,
  Subscription,
  TopicPartition,
} from '../ports.js';
import { KAFKA_CLIENT, toHeaders } from './client.js';

// Keeps a failing handler (e.g. S3 down) from spinning on the same messages
const RETRY_DELAY_MS = 1_000;

const partitionKey = ({ topic, partition }: TopicPartition) =>
  `${topic}:${partition}`;

type ActiveConsumer = {
  consumer: KafkaJS.Consumer;
  /** Runs before disconnecting: drop whatever was buffered for the owned partitions. */
  onStop(): void;
};

@Injectable()
export class KafkaConsumerFactory
  extends MessageConsumerFactory
  implements OnApplicationShutdown
{
  private readonly logger = new Logger(KafkaConsumerFactory.name);
  private readonly active = new Set<ActiveConsumer>();

  constructor(@Inject(KAFKA_CLIENT) private readonly kafka: KafkaJS.Kafka) {
    super();
  }

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
    if (batchSize !== undefined && !(batchSize >= 1)) {
      throw new Error(`batchSize must be >= 1, got ${batchSize}`);
    }

    const chunkers = new Map<string, PartitionChunker>();
    const dropChunker = (key: string) => {
      chunkers.get(key)?.drop();
      chunkers.delete(key);
    };

    // Buffered messages of a revoked partition were never committed: drop
    // them and let the next owner read them again from the last commit
    const consumer = this.createConsumer(groupId, fromBeginning, (revoked) => {
      for (const tp of revoked) dropChunker(partitionKey(tp));
    });

    const chunkerFor = (topic: string, partition: number) => {
      const key = partitionKey({ topic, partition });
      let chunker = chunkers.get(key);
      if (!chunker) {
        chunker = new PartitionChunker(
          { batchSize, maxWaitMs, retryDelayMs: RETRY_DELAY_MS },
          {
            flush: async (chunk) => {
              await handler(chunk);
              await this.commit(consumer, chunk[chunk.length - 1]);
            },
            // The client re-fetches from here; anything fetched past it is discarded
            rewind: (offset) => consumer.seek({ topic, partition, offset }),
            onError: (err) =>
              this.logger.error(
                `Chunk on ${topic}[${partition}] failed, redelivering from its first offset`,
                err instanceof Error ? err.stack : String(err),
              ),
          },
        );
        chunkers.set(key, chunker);
      }
      return chunker;
    };

    return this.start(
      { consumer, onStop: () => [...chunkers.keys()].forEach(dropChunker) },
      topics,
      {
        // Resolving the fetched batch only moves the client's fetch position;
        // offsets are committed by the chunker once the handler succeeded
        eachBatch: async ({ batch }) => {
          await chunkerFor(batch.topic, batch.partition).push(
            batch.messages.map((message) =>
              toIncoming(batch.topic, batch.partition, message),
            ),
          );
        },
      },
    );
  }

  async subscribeEach(
    { groupId, topics, fromBeginning = false, onRevoked }: SubscribeEachOptions,
    handler: MessageHandler,
  ): Promise<MessageSubscription> {
    const owned = new Map<string, TopicPartition>();
    // Only report partitions still owned: stopping revokes them itself, and the
    // client's own revoke during disconnect must not report them a second time
    const revoke = (partitions: TopicPartition[]) => {
      const lost = partitions.filter((tp) => owned.delete(partitionKey(tp)));
      if (lost.length > 0) onRevoked?.(lost);
    };

    const consumer = this.createConsumer(
      groupId,
      fromBeginning,
      revoke,
      (assigned) => {
        for (const tp of assigned) owned.set(partitionKey(tp), tp);
      },
    );

    let stopped = false;
    // Rewinds per partition, so a handler that rewinds and then throws keeps its rewind
    const rewinds = new Map<string, number>();
    const context: MessageContext = {
      commit: (message) => this.commit(consumer, message),
      rewind: ({ topic, partition, offset }) => {
        if (stopped) return;
        const key = partitionKey({ topic, partition });
        rewinds.set(key, (rewinds.get(key) ?? 0) + 1);
        consumer.seek({ topic, partition, offset });
      },
    };

    const subscription = await this.start(
      {
        consumer,
        onStop: () => {
          stopped = true;
          revoke([...owned.values()]);
        },
      },
      topics,
      {
        eachMessage: async ({ topic, partition, message }) => {
          const key = partitionKey({ topic, partition });
          const rewindsBefore = rewinds.get(key);
          try {
            await handler(toIncoming(topic, partition, message), context);
          } catch (err) {
            // Rethrowing would make the client seek back to this message,
            // overriding the handler's own rewind
            if (rewinds.get(key) !== rewindsBefore) return;
            await sleep(RETRY_DELAY_MS);
            // Rethrown: the client logs it and seeks back to this message
            throw err;
          }
        },
      },
    );

    return { ...subscription, ...context };
  }

  private createConsumer(
    groupId: string,
    fromBeginning: boolean,
    onRevoke: (partitions: TopicPartition[]) => void,
    onAssign?: (partitions: TopicPartition[]) => void,
  ): KafkaJS.Consumer {
    return this.kafka.consumer({
      kafkaJS: { groupId, fromBeginning, autoCommit: false },
      rebalance_cb: (
        err: { code: number },
        assignment: KafkaJS.TopicPartition[],
      ) => {
        if (err.code === KafkaJS.ErrorCodes.ERR__REVOKE_PARTITIONS) {
          onRevoke(assignment);
        } else if (err.code === KafkaJS.ErrorCodes.ERR__ASSIGN_PARTITIONS) {
          onAssign?.(assignment);
        }
      },
    });
  }

  private async start(
    entry: ActiveConsumer,
    topics: string[],
    run: KafkaJS.ConsumerRunConfig,
  ): Promise<Subscription> {
    await entry.consumer.connect();
    this.active.add(entry);

    try {
      await entry.consumer.subscribe({ topics });
      await entry.consumer.run(run);
    } catch (err) {
      await this.disconnect(entry);
      throw err;
    }

    return { stop: () => this.disconnect(entry) };
  }

  private async commit(
    consumer: KafkaJS.Consumer,
    { topic, partition, offset }: MessagePosition,
  ) {
    // Kafka stores the next offset to read, hence +1
    await consumer.commitOffsets([
      { topic, partition, offset: (BigInt(offset) + 1n).toString() },
    ]);
  }

  private async disconnect(entry: ActiveConsumer) {
    if (!this.active.delete(entry)) return;
    entry.onStop();
    await entry.consumer.disconnect();
  }

  async onApplicationShutdown() {
    await Promise.all([...this.active].map((c) => this.disconnect(c)));
  }
}

function toIncoming(
  topic: string,
  partition: number,
  message: KafkaJS.KafkaMessage,
): IncomingMessage {
  return {
    topic,
    partition,
    offset: message.offset,
    key: message.key?.toString() ?? null,
    value: message.value?.toString() ?? null,
    headers: toHeaders(message.headers),
  };
}
