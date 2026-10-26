import { ObjectStorage } from '../ports.js';

export type ContractHarness = {
  storage: ObjectStorage;
  close(): Promise<void>;
};

/**
 * Behaviour every implementation of the port must share. Runs against
 * InMemoryObjectStorage in unit tests and against SeaweedFS in e2e, so the
 * fake can't quietly drift from S3.
 */
export function describeStorageContract(
  name: string,
  setup: () => Promise<ContractHarness>,
) {
  describe(`Storage contract: ${name}`, () => {
    let h: ContractHarness;
    let prefix: string;
    let seq = 0;

    beforeAll(async () => {
      h = await setup();
    }, 60_000);

    afterAll(async () => {
      await h?.close();
    });

    // Every test gets its own prefix, so a shared bucket never leaks between tests
    beforeEach(() => {
      prefix = `contract-${Date.now()}-${seq++}/`;
    });

    afterEach(async () => {
      if (!h) return;
      for (const key of await h.storage.list(prefix)) {
        await h.storage.delete(key);
      }
    });

    const text = (body: Uint8Array) => new TextDecoder().decode(body);

    it('reads back what was put, with its content type', async () => {
      await h.storage.put(`${prefix}a.txt`, 'hello', {
        contentType: 'text/plain',
      });

      const object = await h.storage.get(`${prefix}a.txt`);

      expect(text(object!.body)).toBe('hello');
      expect(object!.contentType).toBe('text/plain');
    });

    it('stores binary bodies byte for byte', async () => {
      const bytes = new Uint8Array([0, 1, 254, 255]);

      await h.storage.put(`${prefix}bin`, bytes);

      expect((await h.storage.get(`${prefix}bin`))!.body).toEqual(bytes);
    });

    it('overwrites an existing key', async () => {
      await h.storage.put(`${prefix}k`, 'first');
      await h.storage.put(`${prefix}k`, 'second');

      expect(text((await h.storage.get(`${prefix}k`))!.body)).toBe('second');
    });

    it('reads a missing key as null', async () => {
      expect(await h.storage.get(`${prefix}missing`)).toBeNull();
    });

    it('lists keys under a prefix in ascending order', async () => {
      await h.storage.put(`${prefix}b/2`, 'x');
      await h.storage.put(`${prefix}a/1`, 'x');
      await h.storage.put(`${prefix}b/1`, 'x');

      expect(await h.storage.list(`${prefix}b/`)).toEqual([
        `${prefix}b/1`,
        `${prefix}b/2`,
      ]);
      expect(await h.storage.list(prefix)).toEqual([
        `${prefix}a/1`,
        `${prefix}b/1`,
        `${prefix}b/2`,
      ]);
    });

    it('lists an unused prefix as empty', async () => {
      expect(await h.storage.list(prefix)).toEqual([]);
    });

    it('deletes a key, and deleting a missing key succeeds', async () => {
      await h.storage.put(`${prefix}gone`, 'x');

      await h.storage.delete(`${prefix}gone`);
      await h.storage.delete(`${prefix}never-existed`);

      expect(await h.storage.get(`${prefix}gone`)).toBeNull();
      expect(await h.storage.list(prefix)).toEqual([]);
    });
  });
}
