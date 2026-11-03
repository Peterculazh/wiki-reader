import { Module } from '@nestjs/common';
import { KafkaModule } from '@app/kafka';
import { IngesterService } from './ingester.service.js';
import { ConfigModule, ConfigService } from '@nestjs/config';

@Module({
  imports: [
    KafkaModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        clientId: 'ingester',
        brokers: config.getOrThrow<string>('KAFKA_BROKERS').split(','),
      }),
    }),
    ConfigModule.forRoot({
      envFilePath: ['apps/ingester/.env', '.env'],
    }),
  ],
  providers: [IngesterService],
})
export class IngesterModule {}
