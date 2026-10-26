import { TestingModuleBuilder } from '@nestjs/testing';
import { ObjectStorage } from '../ports.js';
import { InMemoryObjectStorage } from './in-memory-object-storage.js';

/**
 * Swaps the storage port of an app module for `storage`:
 *
 *   const storage = new InMemoryObjectStorage();
 *   overrideStorage(Test.createTestingModule({ imports: [AppModule] }), storage).compile();
 *
 * The S3 adapter is never instantiated, so nothing connects to a server.
 */
export function overrideStorage(
  builder: TestingModuleBuilder,
  storage: InMemoryObjectStorage = new InMemoryObjectStorage(),
): TestingModuleBuilder {
  return builder.overrideProvider(ObjectStorage).useValue(storage);
}
