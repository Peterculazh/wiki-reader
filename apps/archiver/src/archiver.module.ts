import { Module } from '@nestjs/common';
import { KafkaModule } from '@app/kafka';
import { ArchiverService } from './archiver.service.js';

@Module({
  imports: [
    KafkaModule.forRoot({
      clientId: 'archiver',
      brokers: (process.env.KAFKA_BROKERS ?? 'localhost:9092').split(','),
    }),
  ],
  providers: [ArchiverService],
})
export class ArchiverModule {}
