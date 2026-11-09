import { type INestApplication, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { HealthModule } from '@app/health';
import { KafkaModule } from '@app/kafka';
import { API_CONFIG, apiConfigFromEnv, type ApiConfig } from './api.config.js';
import { LiveController } from './live.controller.js';
import { LiveFeedService } from './live-feed.service.js';

@Module({
  imports: [
    HealthModule,
    KafkaModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        clientId: 'api',
        brokers: config.getOrThrow<string>('KAFKA_BROKERS').split(','),
      }),
    }),
    ConfigModule.forRoot({
      envFilePath: ['apps/api/.env', '.env'],
    }),
  ],
  controllers: [LiveController],
  providers: [
    { provide: API_CONFIG, useFactory: () => apiConfigFromEnv() },
    LiveFeedService,
  ],
})
export class ApiModule {}

/** HTTP setup shared by main.ts and the tests */
export function configureApi(app: INestApplication) {
  // The browser opens GET /live itself, from the dashboard's origin, so the
  // stream needs CORS. Server components call the api server to server and don't.
  app.enableCors({ origin: app.get<ApiConfig>(API_CONFIG).webOrigins });
  return app;
}
