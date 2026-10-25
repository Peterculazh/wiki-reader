import {
  Inject,
  Injectable,
  OnApplicationShutdown,
  OnModuleInit,
} from '@nestjs/common';
import { KafkaJS } from '@confluentinc/kafka-javascript';
import { MessageProducer, OutgoingMessage } from '../ports.js';
import { KAFKA_CLIENT } from './client.js';

@Injectable()
export class KafkaMessageProducer
  extends MessageProducer
  implements OnModuleInit, OnApplicationShutdown
{
  private readonly producer: KafkaJS.Producer;

  constructor(@Inject(KAFKA_CLIENT) kafka: KafkaJS.Kafka) {
    super();
    this.producer = kafka.producer();
  }

  async onModuleInit() {
    await this.producer.connect();
  }

  async send(topic: string, messages: OutgoingMessage[]): Promise<void> {
    await this.producer.send({ topic, messages });
  }

  // Shutdown runs after every onModuleDestroy, so app services stop sending first
  async onApplicationShutdown() {
    await this.producer.disconnect();
  }
}
