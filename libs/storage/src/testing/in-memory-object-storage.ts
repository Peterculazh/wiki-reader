import { ObjectStorage, PutOptions, StoredObject } from '../ports.js';

/** `ObjectStorage` kept in a Map, for tests. Plus helpers to inspect and break it. */
export class InMemoryObjectStorage extends ObjectStorage {
  private readonly objects = new Map<string, StoredObject>();
  private readonly putFailures: Error[] = [];

  async put(
    key: string,
    body: string | Uint8Array,
    options: PutOptions = {},
  ): Promise<void> {
    const failure = this.putFailures.shift();
    if (failure) throw failure;
    const bytes =
      typeof body === 'string' ? new TextEncoder().encode(body) : body;
    // Copy, so a caller mutating its buffer later can't change what was stored
    this.objects.set(key, {
      body: new Uint8Array(bytes),
      contentType: options.contentType,
    });
  }

  async get(key: string): Promise<StoredObject | null> {
    const object = this.objects.get(key);
    return object ? { ...object, body: new Uint8Array(object.body) } : null;
  }

  async list(prefix = ''): Promise<string[]> {
    return [...this.objects.keys()].filter((k) => k.startsWith(prefix)).sort();
  }

  async delete(key: string): Promise<void> {
    this.objects.delete(key);
  }

  /** Stored body decoded as UTF-8, or undefined when `key` is missing. */
  text(key: string): string | undefined {
    const object = this.objects.get(key);
    return object && new TextDecoder().decode(object.body);
  }

  /** Makes the next `put` reject with `error` without storing anything. */
  failNextPut(
    error: Error = new Error('InMemoryObjectStorage: put failed'),
  ): void {
    this.putFailures.push(error);
  }
}
