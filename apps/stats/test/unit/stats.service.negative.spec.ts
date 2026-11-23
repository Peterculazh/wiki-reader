import type { Mock } from 'vitest';
import { InMemoryKafka } from '@app/kafka/testing';
import { StatsService } from '../../src/domain/stats.service.js';
import type { ChangesRepository } from '../../src/domain/changes.repository.js';
import { editEventJson } from '../fixtures.js';

describe('StatsService: NEGATIVE', () => {
  let kafka: InMemoryKafka;
  let insertMany: Mock<ChangesRepository['insertMany']>;
  let service: StatsService;

  beforeEach(async () => {
    kafka = new InMemoryKafka();
    insertMany = vi
      .fn<ChangesRepository['insertMany']>()
      .mockResolvedValue(undefined);
    // {}: no buffering, every fetched batch is one chunk, so drain() is enough
    service = new StatsService(
      kafka,
      { insertMany } as unknown as ChangesRepository,
      {},
    );
    await service.onModuleInit();
  });

  afterEach(async () => {
    await service.onModuleDestroy();
  });

  it('Should skip invalid JSON', async () => {
    await kafka.send('wiki.changes', [{ value: 'oops' }]);
    await kafka.drain();

    expect(kafka.handlerErrors).toHaveLength(0);
    expect(insertMany).not.toHaveBeenCalled();
  });

  it('Should store the rest of a chunk that has invalid JSON', async () => {
    await kafka.send('wiki.changes', [
      { value: 'oops' },
      { value: editEventJson('m1') },
    ]);
    await kafka.drain();

    expect(kafka.handlerErrors).toHaveLength(0);
    expect(
      insertMany.mock.calls.map(([changes]) =>
        changes.map((change) => change.eventId),
      ),
    ).toEqual([['m1']]);
  });

  it('Should retry on single failed connection to DB', async () => {
    insertMany.mockRejectedValueOnce(new Error('db down'));
    await kafka.send('wiki.changes', [
      { value: editEventJson('m0') },
      { value: editEventJson('m1') },
    ]);
    await kafka.drain();

    expect(kafka.handlerErrors).toHaveLength(1);
    // The whole chunk comes back, not just the message that was "current"
    expect(
      insertMany.mock.calls.map(([changes]) =>
        changes.map((change) => change.eventId),
      ),
    ).toEqual([
      ['m0', 'm1'],
      ['m0', 'm1'],
    ]);
  });
});
