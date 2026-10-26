import { DynamicModule, Module } from '@nestjs/common';
import { ObjectStorage } from '../ports.js';
import { InMemoryObjectStorage } from './in-memory-object-storage.js';

/**
 * `StorageModule.forRoot(...)` stand-in backed by `InMemoryObjectStorage`, for
 * tests that assemble their own module. To swap storage out of an existing app
 * module, use `overrideStorage` instead.
 */
@Module({})
export class StorageTestingModule {
  static forRoot(
    storage: InMemoryObjectStorage = new InMemoryObjectStorage(),
  ): DynamicModule {
    return {
      module: StorageTestingModule,
      providers: [
        { provide: InMemoryObjectStorage, useValue: storage },
        { provide: ObjectStorage, useValue: storage },
      ],
      exports: [InMemoryObjectStorage, ObjectStorage],
    };
  }
}
