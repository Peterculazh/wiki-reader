import { TestingModuleBuilder } from '@nestjs/testing';
import {
  CompactedTopicReader,
  MessageConsumerFactory,
  MessageProducer,
} from '../ports.js';
import { InMemoryKafka } from './in-memory-kafka.js';

/**
 * Swaps every Kafka port of an app module for `kafka`:
 *
 *   const kafka = new InMemoryKafka();
 *   overrideKafka(Test.createTestingModule({ imports: [AppModule] }), kafka).compile();
 *
 * The real adapters are never instantiated, so nothing connects to a broker.
 */
export function overrideKafka(
  builder: TestingModuleBuilder,
  kafka: InMemoryKafka = new InMemoryKafka(),
): TestingModuleBuilder {
  return builder
    .overrideProvider(MessageProducer)
    .useValue(kafka)
    .overrideProvider(MessageConsumerFactory)
    .useValue(kafka)
    .overrideProvider(CompactedTopicReader)
    .useValue(kafka);
}
