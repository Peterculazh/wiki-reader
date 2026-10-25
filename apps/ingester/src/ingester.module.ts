import { Module } from '@nestjs/common';
import { KafkaModule } from '@app/kafka';
import { IngesterService } from './ingester.service.js';

@Module({
  imports: [
    KafkaModule.forRoot({
      clientId: 'ingester',
      brokers: (process.env.KAFKA_BROKERS ?? 'localhost:9092').split(','),
    }),
  ],
  providers: [IngesterService],
})
export class IngesterModule {}
