import type { Mock } from 'vitest';
import { InMemoryKafka } from '@app/kafka/testing';
import { StatsService } from '../../src/domain/stats.service.js';
import type { ChangesRepository } from '../../src/domain/changes.repository.js';
import { editEventJson } from '../fixtures.js';

describe('StatsService: restart', () => {
  let kafka: InMemoryKafka;
  let insertMany: Mock<ChangesRepository['insertMany']>;
  let repo: ChangesRepository;

  const storedIds = () =>
    insertMany.mock.calls.flatMap(([changes]) =>
      changes.map((change) => change.eventId),
    );

  beforeEach(() => {
    kafka = new InMemoryKafka();
    insertMany = vi
      .fn<ChangesRepository['insertMany']>()
      .mockResolvedValue(undefined);
    repo = { insertMany } as unknown as ChangesRepository;
  });

  it('Should not reprocess or lose messages after a restart', async () => {
    const first = new StatsService(kafka, repo, {});
    await first.onModuleInit();
    await kafka.send('wiki.changes', [{ value: editEventJson('m0') }]);
    await kafka.drain();
    await first.onModuleDestroy();

    await kafka.send('wiki.changes', [{ value: editEventJson('m1') }]);

    const second = new StatsService(kafka, repo, {});
    await second.onModuleInit();
    await kafka.drain();
    await second.onModuleDestroy();

    expect(storedIds()).toEqual(['m0', 'm1']);
  });

  it('Should redeliver a chunk that was still buffered when it stopped', async () => {
    // A chunk of 10 never fills up here, and without maxWaitMs it is never
    // flushed: m0 stays in memory, uncommitted
    const first = new StatsService(kafka, repo, { batchSize: 10 });
    await first.onModuleInit();
    await kafka.send('wiki.changes', [{ value: editEventJson('m0') }]);
    await kafka.drain();
    await first.onModuleDestroy();

    expect(insertMany).not.toHaveBeenCalled();

    const second = new StatsService(kafka, repo, {});
    await second.onModuleInit();
    await kafka.drain();
    await second.onModuleDestroy();

    expect(storedIds()).toEqual(['m0']);
  });
});
