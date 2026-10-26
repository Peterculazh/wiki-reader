import { describeStorageContract } from './storage.contract.js';
import { InMemoryObjectStorage } from './in-memory-object-storage.js';

describeStorageContract('InMemoryObjectStorage', async () => ({
  storage: new InMemoryObjectStorage(),
  close: async () => {},
}));

describe('InMemoryObjectStorage helpers', () => {
  it('decodes a stored body with text()', async () => {
    const storage = new InMemoryObjectStorage();

    await storage.put('k', 'héllo');

    expect(storage.text('k')).toBe('héllo');
    expect(storage.text('missing')).toBeUndefined();
  });

  it('fails the next put only, without storing it', async () => {
    const storage = new InMemoryObjectStorage();
    storage.failNextPut(new Error('boom'));

    await expect(storage.put('lost', 'x')).rejects.toThrow('boom');
    await storage.put('kept', 'x');

    expect(await storage.list()).toEqual(['kept']);
  });

  it('is not affected by later mutation of the put buffer', async () => {
    const storage = new InMemoryObjectStorage();
    const bytes = new Uint8Array([1, 2]);

    await storage.put('k', bytes);
    bytes[0] = 9;

    expect((await storage.get('k'))!.body).toEqual(new Uint8Array([1, 2]));
  });
});
