import { Module } from '@nestjs/common';
import { HealthModule } from '@app/health';
import { KafkaModule } from '@app/kafka';
import { StorageModule } from '@app/storage';
import { ArchiverService } from './archiver.service.js';
import { ConfigModule, ConfigService } from '@nestjs/config';

@Module({
  imports: [
    HealthModule,
    KafkaModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        clientId: 'archiver',
        brokers: config.getOrThrow<string>('KAFKA_BROKERS').split(','),
      }),
    }),
    // Defaults target SeaweedFS from docker-compose (identity in seaweedfs/s3.json)
    StorageModule.forRoot({
      bucket: process.env.S3_BUCKET ?? 'wiki-archive',
      endpoint: process.env.S3_ENDPOINT ?? 'http://localhost:8333',
      region: process.env.S3_REGION,
      credentials: {
        accessKeyId: process.env.S3_ACCESS_KEY_ID ?? 'dev',
        secretAccessKey: process.env.S3_SECRET_ACCESS_KEY ?? 'devsecret',
      },
      createBucket: process.env.S3_CREATE_BUCKET !== 'false',
    }),
    ConfigModule.forRoot({
      envFilePath: ['apps/archiver/.env', '.env'],
    }),
  ],
  providers: [ArchiverService],
})
export class ArchiverModule {}
