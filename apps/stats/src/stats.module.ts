import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { PostgresModule } from '@app/postgres';
import { KafkaModule } from '@app/kafka';
import { StatsService } from './domain/stats.service.js';
import { HealthModule } from '@app/health';
import { ChangesRepository } from './domain/changes.repository.js';
import { StatsController } from './api/stats.controller.js';

@Module({
  imports: [
    PostgresModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        connectionString: config.getOrThrow<string>('DATABASE_URL'),
      }),
    }),
    KafkaModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        clientId: 'stats',
        brokers: config.getOrThrow<string>('KAFKA_BROKERS').split(','),
      }),
    }),
    ConfigModule.forRoot({
      envFilePath: ['apps/stats/.env', '.env'],
    }),
    HealthModule,
  ],
  providers: [StatsService, ChangesRepository],
  controllers: [StatsController],
})
export class StatsModule {}
