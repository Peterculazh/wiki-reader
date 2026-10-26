import { DynamicModule, Module } from '@nestjs/common';
import {
  createS3Client,
  S3_CLIENT,
  STORAGE_OPTIONS,
  type StorageModuleOptions,
} from './s3/client.js';
import { S3ObjectStorage } from './s3/s3-object-storage.js';
import { ObjectStorage } from './ports.js';

@Module({})
export class StorageModule {
  static forRoot(options: StorageModuleOptions): DynamicModule {
    return {
      module: StorageModule,
      providers: [
        { provide: STORAGE_OPTIONS, useValue: options },
        { provide: S3_CLIENT, useFactory: () => createS3Client(options) },
        { provide: ObjectStorage, useClass: S3ObjectStorage },
      ],
      exports: [ObjectStorage],
    };
  }
}
