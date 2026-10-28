import { Inject, Injectable } from '@nestjs/common';
import { KafkaJS } from '@confluentinc/kafka-javascript';
import { TopicAdmin } from '../ports.js';
import { KAFKA_CLIENT } from './client.js';

@Injectable()
export class KafkaTopicAdmin extends TopicAdmin {
  constructor(@Inject(KAFKA_CLIENT) private readonly kafka: KafkaJS.Kafka) {
    super();
  }

  async ensureTopic(
    topic: string,
    { numPartitions }: { numPartitions: number },
  ): Promise<void> {
    const admin = this.kafka.admin();
    try {
      await admin.connect();
      // Resolves false instead of throwing when the topic already exists
      await admin.createTopics({ topics: [{ topic, numPartitions }] });
    } finally {
      await admin.disconnect();
    }
  }
}
