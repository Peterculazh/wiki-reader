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

  beforeEach(() => {
    kafka = new InMemoryKafka();
    storage = new InMemoryObjectStorage();
  });

  it('writes every 300 messages of a partition as one NDJSON object', async () => {
    const app = await start();

    await kafka.send('wiki.changes', events(0, 650));
    await kafka.drain();

    expect(await storage.list()).toEqual([
      'wiki.changes/partition=0/00000000000000000000-00000000000000000299.jsonl',
      'wiki.changes/partition=0/00000000000000000300-00000000000000000599.jsonl',
    ]);
    const lines = storage.text(
      'wiki.changes/partition=0/00000000000000000000-00000000000000000299.jsonl',
    )!;
    expect(lines.split('\n').slice(0, 2)).toEqual(['{"id":0}', '{"id":1}']);
    expect(lines.trimEnd().split('\n')).toHaveLength(300);
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
      'wiki.changes/partition=0/00000000000000000000-00000000000000000299.jsonl',
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
      'wiki.changes/partition=0/00000000000000000000-00000000000000000299.jsonl',
      'wiki.changes/partition=0/00000000000000000300-00000000000000000599.jsonl',
    ]);
    await second.close();
  });
});
