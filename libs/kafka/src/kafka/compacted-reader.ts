import { Inject, Injectable } from '@nestjs/common';
import { KafkaJS } from '@confluentinc/kafka-javascript';
import { CompactedTopicReader } from '../ports.js';
import {
  KAFKA_CLIENT,
  KAFKA_OPTIONS,
  type KafkaModuleOptions,
} from './client.js';

@Injectable()
export class KafkaCompactedTopicReader extends CompactedTopicReader {
  constructor(
    @Inject(KAFKA_CLIENT) private readonly kafka: KafkaJS.Kafka,
    @Inject(KAFKA_OPTIONS) private readonly options: KafkaModuleOptions,
  ) {
    super();
  }

  async readAll(
    topic: string,
    { timeoutMs = 10_000 }: { timeoutMs?: number } = {},
  ): Promise<Map<string, string>> {
    const admin = this.kafka.admin();
    let partitions: { partition: number; high: string; low: string }[];
    try {
      await admin.connect();
      partitions = await admin.fetchTopicOffsets(topic);
    } finally {
      await admin.disconnect();
    }

    // Last offset to wait for on each partition that has data
    const pending = new Map<number, number>();
    for (const { partition, high, low } of partitions) {
      if (Number(high) > Number(low)) pending.set(partition, Number(high) - 1);
    }

    const values = new Map<string, string>();
    if (pending.size === 0) return values;

    // Throwaway group: no committed offsets, always reads the whole (small) compacted topic
    const consumer = this.kafka.consumer({
      kafkaJS: {
        groupId: `${this.options.clientId}-compacted-reader-${Date.now()}`,
        fromBeginning: true,
        autoCommit: false,
      },
    });

    let timeout: NodeJS.Timeout | undefined;
    try {
      await consumer.connect();
      await consumer.subscribe({ topics: [topic] });

      await new Promise<void>((resolve, reject) => {
        timeout = setTimeout(
          () => reject(new Error(`Timed out reading ${topic}`)),
          timeoutMs,
        );

        consumer
          .run({
            eachMessage: async ({ partition, message }) => {
              const key = message.key?.toString();
              if (key !== undefined) {
                if (message.value) values.set(key, message.value.toString());
                else values.delete(key);
              }

              const last = pending.get(partition);
              if (last !== undefined && Number(message.offset) >= last) {
                pending.delete(partition);
                if (pending.size === 0) resolve();
              }
            },
          })
          .catch(reject);
      });
    } finally {
      clearTimeout(timeout);
      await consumer.disconnect();
    }

    return values;
  }
}
