import { gunzipSync } from 'node:zlib';
import { Test } from '@nestjs/testing';
import { InMemoryKafka, overrideKafka } from '@app/kafka/testing';
import { InMemoryObjectStorage, overrideStorage } from '@app/storage/testing';
import { ArchiverModule } from './archiver.module.js';

describe('ArchiverService', () => {
  let kafka: InMemoryKafka;
  let storage: InMemoryObjectStorage;

  async function start() {
    const builder = Test.createTestingModule({ imports: [ArchiverModule] });
    const moduleRef = await overrideStorage(
      overrideKafka(builder, kafka),
      storage,
    ).compile();
    return moduleRef.init();
  }

  const events = (from: number, to: number) =>
    Array.from({ length: to - from }, (_, i) => ({
      value: `{"id":${from + i}}`,
    }));

  // Objects are gzipped NDJSON: unzip and split into lines
  const lines = async (key: string) => {
    const object = (await storage.get(key))!;
    return gunzipSync(object.body).toString('utf8').trimEnd().split('\n');
  };

  // Advancing fake time only flushes microtasks, but gzip finishes on the thread
  // pool: drain() waits until the flush the timer started has been stored
  const elapse = async (ms: number) => {
    await vi.advanceTimersByTimeAsync(ms);
    await kafka.drain();
  };

  beforeEach(() => {
    kafka = new InMemoryKafka();
    storage = new InMemoryObjectStorage();
    // Only timeouts are faked; the in-memory fakes keep their real async flow
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('writes every 300 messages of a partition as one gzipped NDJSON object', async () => {
    const app = await start();

    await kafka.send('wiki.changes', events(0, 650));
    await kafka.drain();

    expect(await storage.list()).toEqual([
      'wiki.changes/partition=0/00000000000000000000.jsonl.gz',
      'wiki.changes/partition=0/00000000000000000300.jsonl.gz',
    ]);
    const key = 'wiki.changes/partition=0/00000000000000000000.jsonl.gz';
    expect((await storage.get(key))!.contentType).toBe('application/gzip');
    const first = await lines(key);
    expect(first.slice(0, 2)).toEqual(['{"id":0}', '{"id":1}']);
    expect(first).toHaveLength(300);
    await app.close();
  });

  it('retries a chunk whose put failed, under the same key', async () => {
    storage.failNextPut();
    const app = await start();

    await kafka.send('wiki.changes', events(0, 300));
    await kafka.drain();
    // The fake re-reads a rewound partition on the next send/drain
    await kafka.drain();

    expect(await storage.list()).toEqual([
      'wiki.changes/partition=0/00000000000000000000.jsonl.gz',
    ]);
    await app.close();
  });

  it('re-reads the uncommitted remainder after a restart', async () => {
    const first = await start();
    await kafka.send('wiki.changes', events(0, 350));
    await kafka.drain();
    await first.close();

    const second = await start();
    await kafka.send('wiki.changes', events(350, 600));
    await kafka.drain();

    expect(await storage.list()).toEqual([
      'wiki.changes/partition=0/00000000000000000000.jsonl.gz',
      'wiki.changes/partition=0/00000000000000000300.jsonl.gz',
    ]);
    await second.close();
  });

  it('archives and commits a partial buffer every 60 seconds', async () => {
    const first = await start();
    await kafka.send('wiki.changes', events(0, 350));
    await kafka.drain();
    expect(await storage.list()).toEqual([
      'wiki.changes/partition=0/00000000000000000000.jsonl.gz',
    ]);

    await elapse(60_000);
    expect(await storage.list()).toEqual([
      'wiki.changes/partition=0/00000000000000000000.jsonl.gz',
      'wiki.changes/partition=0/00000000000000000300.jsonl.gz',
    ]);
    await first.close();

    // Committed: a restart continues after 349 instead of re-reading it
    const second = await start();
    await kafka.send('wiki.changes', events(350, 650));
    await kafka.drain();

    expect(await storage.list()).toEqual([
      'wiki.changes/partition=0/00000000000000000000.jsonl.gz',
      'wiki.changes/partition=0/00000000000000000300.jsonl.gz',
      'wiki.changes/partition=0/00000000000000000350.jsonl.gz',
    ]);
    await second.close();
  });

  it('counts the 60 seconds from the first buffered message', async () => {
    const app = await start();
    await kafka.send('wiki.changes', events(0, 10));
    await kafka.drain();
    await elapse(30_000);
    await kafka.send('wiki.changes', events(10, 20));
    await kafka.drain();

    await elapse(29_999);
    expect(await storage.list()).toEqual([]);
    await elapse(1);
    expect(await storage.list()).toEqual([
      'wiki.changes/partition=0/00000000000000000000.jsonl.gz',
    ]);
    expect(
      (await lines('wiki.changes/partition=0/00000000000000000000.jsonl.gz'))
        .length,
    ).toBe(20);
    await app.close();
  });

  it('overwrites a partial chunk whose write landed but reported failure', async () => {
    // The object is stored, then the call fails (e.g. a timeout on the response)
    vi.spyOn(storage, 'put').mockImplementationOnce(async (...args) => {
      await InMemoryObjectStorage.prototype.put.apply(storage, args);
      throw new Error('timed out after the write');
    });
    const app = await start();
    await kafka.send('wiki.changes', events(0, 50));
    await kafka.drain();
    await elapse(60_000); // stores 0..49, then rewinds

    await kafka.send('wiki.changes', events(50, 120)); // re-reads 0..49 plus the new ones
    await kafka.drain();
    await elapse(60_000);

    // One object, now holding the superset, not 0..49 next to 0..119
    expect(await storage.list()).toEqual([
      'wiki.changes/partition=0/00000000000000000000.jsonl.gz',
    ]);
    expect(
      (await lines('wiki.changes/partition=0/00000000000000000000.jsonl.gz'))
        .length,
    ).toBe(120);
    await app.close();
  });

  it('retries a failed timed flush under the same key', async () => {
    const app = await start();
    await kafka.send('wiki.changes', events(0, 350));
    await kafka.drain();

    storage.failNextPut();
    await elapse(60_000);
    await kafka.drain(); // re-reads 300..349 after the rewind
    await elapse(60_000);

    expect(await storage.list()).toEqual([
      'wiki.changes/partition=0/00000000000000000000.jsonl.gz',
      'wiki.changes/partition=0/00000000000000000300.jsonl.gz',
    ]);
    await app.close();
  });
});
