import { Test } from '@nestjs/testing';
import { KafkaJS } from '@confluentinc/kafka-javascript';
import {
  CompactedTopicReader,
  KafkaModule,
  MessageConsumerFactory,
  MessageProducer,
} from '@app/kafka';
import { describeKafkaContract } from '../src/testing/kafka.contract.js';

// Needs the broker from docker-compose: `docker compose up -d broker`
const brokers = (process.env.KAFKA_BROKERS ?? 'localhost:9092').split(',');

describeKafkaContract(`real broker (${brokers.join(',')})`, async () => {
  const moduleRef = await Test.createTestingModule({
    imports: [KafkaModule.forRoot({ clientId: 'kafka-contract', brokers })],
  }).compile();
  const app = await moduleRef.init();

  const admin = new KafkaJS.Kafka({ kafkaJS: { brokers } }).admin();
  await admin.connect();
  const created: string[] = [];

  return {
    producer: app.get(MessageProducer),
    consumers: app.get(MessageConsumerFactory),
    reader: app.get(CompactedTopicReader),
    createTopic: async (name) => {
      await admin.createTopics({ topics: [{ topic: name, numPartitions: 1 }] });
      created.push(name);
    },
    timeoutMs: 30_000,
    settleMs: 1_000,
    close: async () => {
      await app.close();
      await admin.deleteTopics({ topics: created }).catch(() => {});
      await admin.disconnect();
    },
  };
});
