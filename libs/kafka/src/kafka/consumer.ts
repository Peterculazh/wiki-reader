import { Inject, Injectable, OnApplicationShutdown } from '@nestjs/common';
import { KafkaJS } from '@confluentinc/kafka-javascript';
import {
  BatchHandler,
  MessageConsumerFactory,
  SubscribeOptions,
  Subscription,
} from '../ports.js';
import { KAFKA_CLIENT, toHeaders } from './client.js';

@Injectable()
export class KafkaConsumerFactory
  extends MessageConsumerFactory
  implements OnApplicationShutdown
{
  private readonly active = new Set<KafkaJS.Consumer>();

  constructor(@Inject(KAFKA_CLIENT) private readonly kafka: KafkaJS.Kafka) {
    super();
  }

  async subscribe(
    { groupId, topics, fromBeginning = false }: SubscribeOptions,
    handler: BatchHandler,
  ): Promise<Subscription> {
    const consumer = this.kafka.consumer({
      kafkaJS: { groupId, fromBeginning, autoCommit: false },
    });
    await consumer.connect();
    this.active.add(consumer);

    try {
      await consumer.subscribe({ topics });
      await consumer.run({
        eachBatch: async ({ batch }) => {
          await handler(
            batch.messages.map((message) => ({
              topic: batch.topic,
              partition: batch.partition,
              offset: message.offset,
              key: message.key?.toString() ?? null,
              value: message.value?.toString() ?? null,
              headers: toHeaders(message.headers),
            })),
          );
          // Only reached when the handler resolved; a throw makes the client
          // seek back and redeliver the batch
          await consumer.commitOffsets([
            {
              topic: batch.topic,
              partition: batch.partition,
              offset: (BigInt(batch.lastOffset()) + 1n).toString(),
            },
          ]);
        },
      });
    } catch (err) {
      await this.disconnect(consumer);
      throw err;
    }

    return { stop: () => this.disconnect(consumer) };
  }

  private async disconnect(consumer: KafkaJS.Consumer) {
    if (!this.active.delete(consumer)) return;
    await consumer.disconnect();
  }

  async onApplicationShutdown() {
    await Promise.all([...this.active].map((c) => this.disconnect(c)));
  }
}
