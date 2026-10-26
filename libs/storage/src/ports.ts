// Ports the apps depend on. Abstract classes double as Nest injection tokens,
// so a service just declares `constructor(private storage: ObjectStorage)`.
// Nothing here leaks AWS SDK types: apps and their tests never import the client.

export type PutOptions = {
  contentType?: string;
};

export type StoredObject = {
  body: Uint8Array;
  contentType?: string;
};

/** Objects in the one bucket the module was configured with. */
export abstract class ObjectStorage {
  /** Creates or overwrites `key`, so retrying the same put is safe. */
  abstract put(
    key: string,
    body: string | Uint8Array,
    options?: PutOptions,
  ): Promise<void>;

  /** Resolves null when `key` doesn't exist. */
  abstract get(key: string): Promise<StoredObject | null>;

  /** Every key starting with `prefix`, in ascending order. Pages internally. */
  abstract list(prefix?: string): Promise<string[]>;

  /** Removing a missing key is not an error. */
  abstract delete(key: string): Promise<void>;
}
