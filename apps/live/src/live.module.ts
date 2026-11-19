import { type INestApplication, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { HealthModule } from '@app/health';
import { KafkaModule } from '@app/kafka';
import { LIVE_CONFIG, liveConfigFromEnv, type LiveConfig } from './live.config.js';
import { LiveController } from './live.controller.js';
import { LiveFeedService } from './live-feed.service.js';

@Module({
  imports: [
    HealthModule,
    KafkaModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        clientId: 'live',
        brokers: config.getOrThrow<string>('KAFKA_BROKERS').split(','),
      }),
    }),
    ConfigModule.forRoot({
      envFilePath: ['apps/live/.env', '.env'],
    }),
  ],
  controllers: [LiveController],
  providers: [
    { provide: LIVE_CONFIG, useFactory: () => liveConfigFromEnv() },
    LiveFeedService,
  ],
})
export class LiveModule {}

/** HTTP setup shared by main.ts and the tests */
export function configureLive(app: INestApplication) {
  // The browser opens GET /live itself, from the dashboard's origin, so the
  // stream needs CORS. Server components call the live app server to server and don't.
  app.enableCors({ origin: app.get<LiveConfig>(LIVE_CONFIG).webOrigins });
  return app;
}
