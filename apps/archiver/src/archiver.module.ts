import { Module } from '@nestjs/common';
import { KafkaModule } from '@app/kafka';
import { StorageModule } from '@app/storage';
import { ArchiverService } from './archiver.service.js';

@Module({
  imports: [
    KafkaModule.forRoot({
      clientId: 'archiver',
      brokers: (process.env.KAFKA_BROKERS ?? 'localhost:9092').split(','),
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
  ],
  providers: [ArchiverService],
})
export class ArchiverModule {}
