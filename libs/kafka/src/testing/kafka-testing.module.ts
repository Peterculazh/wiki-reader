import { DynamicModule, Module } from '@nestjs/common';
import {
  CompactedTopicReader,
  MessageConsumerFactory,
  MessageProducer,
  TopicAdmin,
} from '../ports.js';
import { InMemoryKafka } from './in-memory-kafka.js';

/**
 * `KafkaModule.forRoot(...)` stand-in backed by `InMemoryKafka`, for tests that
 * assemble their own module: `imports: [KafkaTestingModule.forRoot(kafka), ...]`.
 * To swap Kafka out of an existing app module, use `overrideKafka` instead.
 */
@Module({})
export class KafkaTestingModule {
  static forRoot(kafka: InMemoryKafka = new InMemoryKafka()): DynamicModule {
    return {
      module: KafkaTestingModule,
      providers: [
        { provide: InMemoryKafka, useValue: kafka },
        { provide: MessageProducer, useValue: kafka },
        { provide: MessageConsumerFactory, useValue: kafka },
        { provide: CompactedTopicReader, useValue: kafka },
        { provide: TopicAdmin, useValue: kafka },
      ],
      exports: [
        InMemoryKafka,
        MessageProducer,
        MessageConsumerFactory,
        CompactedTopicReader,
        TopicAdmin,
      ],
    };
  }
}
