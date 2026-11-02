import {
  DynamicModule,
  InjectionToken,
  Module,
  ModuleMetadata,
  OptionalFactoryDependency,
  Provider,
} from '@nestjs/common';
import {
  createKafkaClient,
  KAFKA_CLIENT,
  KAFKA_OPTIONS,
  type KafkaModuleOptions,
} from './kafka/client.js';
import { KafkaCompactedTopicReader } from './kafka/compacted-reader.js';
import { KafkaConsumerFactory } from './kafka/consumer.js';
import { KafkaMessageProducer } from './kafka/producer.js';
import { KafkaTopicAdmin } from './kafka/topic-admin.js';
import {
  CompactedTopicReader,
  MessageConsumerFactory,
  MessageProducer,
  TopicAdmin,
} from './ports.js';

export type KafkaModuleAsyncOptions = {
  /** Modules exporting the providers listed in `inject` (not needed for global ones like ConfigModule with isGlobal) */
  imports?: ModuleMetadata['imports'];
  inject?: (InjectionToken | OptionalFactoryDependency)[];
  useFactory: (
    ...args: any[]
  ) => KafkaModuleOptions | Promise<KafkaModuleOptions>;
};

// Everything except KAFKA_OPTIONS, which forRoot and forRootAsync provide differently
const kafkaProviders: Provider[] = [
  {
    provide: KAFKA_CLIENT,
    inject: [KAFKA_OPTIONS],
    useFactory: (options: KafkaModuleOptions) => createKafkaClient(options),
  },
  { provide: MessageProducer, useClass: KafkaMessageProducer },
  { provide: MessageConsumerFactory, useClass: KafkaConsumerFactory },
  { provide: CompactedTopicReader, useClass: KafkaCompactedTopicReader },
  { provide: TopicAdmin, useClass: KafkaTopicAdmin },
];

const kafkaExports = [
  MessageProducer,
  MessageConsumerFactory,
  CompactedTopicReader,
  TopicAdmin,
];

@Module({})
export class KafkaModule {
  static forRoot(options: KafkaModuleOptions): DynamicModule {
    return {
      module: KafkaModule,
      providers: [
        { provide: KAFKA_OPTIONS, useValue: options },
        ...kafkaProviders,
      ],
      exports: kafkaExports,
    };
  }

  /** Options are resolved through DI, e.g. from ConfigService, instead of at import time */
  static forRootAsync(options: KafkaModuleAsyncOptions): DynamicModule {
    return {
      module: KafkaModule,
      imports: options.imports ?? [],
      providers: [
        {
          provide: KAFKA_OPTIONS,
          inject: options.inject ?? [],
          useFactory: options.useFactory,
        },
        ...kafkaProviders,
      ],
      exports: kafkaExports,
    };
  }
}
