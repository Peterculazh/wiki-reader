import { Test } from '@nestjs/testing';
import { ObjectStorage, StorageModule } from '@app/storage';
import { describeStorageContract } from '../src/testing/storage.contract.js';

// Needs SeaweedFS from docker-compose: `docker compose up -d seaweedfs`
const endpoint = process.env.S3_ENDPOINT ?? 'http://localhost:8333';

describeStorageContract(`S3 (${endpoint})`, async () => {
  const moduleRef = await Test.createTestingModule({
    imports: [
      StorageModule.forRoot({
        bucket: process.env.S3_BUCKET ?? 'storage-contract',
        endpoint,
        credentials: {
          accessKeyId: process.env.S3_ACCESS_KEY_ID ?? 'dev',
          secretAccessKey: process.env.S3_SECRET_ACCESS_KEY ?? 'devsecret',
        },
        createBucket: true,
      }),
    ],
  }).compile();
  const app = await moduleRef.init();

  return {
    storage: app.get(ObjectStorage),
    close: () => app.close(),
  };
});
