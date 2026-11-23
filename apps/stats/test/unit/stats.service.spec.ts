import type { Mock } from 'vitest';
import { InMemoryKafka } from '@app/kafka/testing';
import { StatsService } from '../../src/domain/stats.service.js';
import type { ChangesRepository } from '../../src/domain/changes.repository.js';
import { editEventJson, makeEditEvent } from '../fixtures.js';

describe('StatsService: POSITIVE', () => {
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

  it('Should store a valid change', async () => {
    await kafka.send('wiki.changes', [
      { value: JSON.stringify(makeEditEvent()) },
    ]);
    await kafka.drain();

    expect(insertMany).toHaveBeenCalledOnce();
    expect(insertMany).toHaveBeenCalledWith([
      expect.objectContaining({
        eventId: '2eff3ca4-683a-461d-b77e-fb1e82748e4d',
      }),
    ]);
  });

  it('Should store a whole chunk with one insert', async () => {
    await kafka.send('wiki.changes', [
      { value: editEventJson('m0') },
      { value: editEventJson('m1') },
      { value: editEventJson('m2') },
    ]);
    await kafka.drain();

    expect(
      insertMany.mock.calls.map(([changes]) =>
        changes.map((change) => change.eventId),
      ),
    ).toEqual([['m0', 'm1', 'm2']]);
  });
});
