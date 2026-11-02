import { Module } from '@nestjs/common';
import { KafkaModule } from '@app/kafka';
import { BURSTS_CONFIG, burstsConfigFromEnv } from './bursts.config.js';
import { BurstsService } from './bursts.service.js';
import { ConfigModule, ConfigService } from '@nestjs/config';

@Module({
  imports: [
    KafkaModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        clientId: 'bursts',
        brokers: config.getOrThrow<string>('KAFKA_BROKERS').split(','),
      }),
    }),
    ConfigModule.forRoot({
      envFilePath: ['apps/bursts/.env', '.env'],
    }),
  ],
  providers: [
    { provide: BURSTS_CONFIG, useFactory: () => burstsConfigFromEnv() },
    BurstsService,
  ],
})
export class BurstsModule {}
