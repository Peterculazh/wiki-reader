import { Module } from '@nestjs/common';
import { KafkaModule } from '@app/kafka';
import { BURSTS_CONFIG, burstsConfigFromEnv } from './bursts.config.js';
import { BurstsService } from './bursts.service.js';

@Module({
  imports: [
    KafkaModule.forRoot({
      clientId: 'bursts',
      brokers: (process.env.KAFKA_BROKERS ?? 'localhost:9092').split(','),
    }),
  ],
  providers: [
    { provide: BURSTS_CONFIG, useFactory: () => burstsConfigFromEnv() },
    BurstsService,
  ],
})
export class BurstsModule {}
