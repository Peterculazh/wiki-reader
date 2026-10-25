import { DynamicModule, Module } from '@nestjs/common';
import {
  createKafkaClient,
  KAFKA_CLIENT,
  KAFKA_OPTIONS,
  type KafkaModuleOptions,
} from './kafka/client.js';
import { KafkaCompactedTopicReader } from './kafka/compacted-reader.js';
import { KafkaConsumerFactory } from './kafka/consumer.js';
import { KafkaMessageProducer } from './kafka/producer.js';
import {
  CompactedTopicReader,
  MessageConsumerFactory,
  MessageProducer,
} from './ports.js';

@Module({})
export class KafkaModule {
  static forRoot(options: KafkaModuleOptions): DynamicModule {
    return {
      module: KafkaModule,
      providers: [
        { provide: KAFKA_OPTIONS, useValue: options },
        { provide: KAFKA_CLIENT, useFactory: () => createKafkaClient(options) },
        { provide: MessageProducer, useClass: KafkaMessageProducer },
        { provide: MessageConsumerFactory, useClass: KafkaConsumerFactory },
        { provide: CompactedTopicReader, useClass: KafkaCompactedTopicReader },
      ],
      exports: [MessageProducer, MessageConsumerFactory, CompactedTopicReader],
    };
  }
}
