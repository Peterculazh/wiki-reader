import type { Mock } from 'vitest';
import { InMemoryKafka } from '@app/kafka/testing';
import { StatsService } from '../src/domain/stats.service.js';
import type { ChangesRepository } from '../src/domain/changes.repository.js';
import { makeEditEvent } from './fixtures.js';

describe('StatsService: NEGATIVE', () => {
  let kafka: InMemoryKafka;
  let insert: Mock<ChangesRepository['insert']>;
  let service: StatsService;

  beforeEach(async () => {
    kafka = new InMemoryKafka();
    insert = vi.fn<ChangesRepository['insert']>().mockResolvedValue(undefined);
    service = new StatsService(kafka, {
      insert,
    } as unknown as ChangesRepository);
    await service.onModuleInit();
  });

  afterEach(async () => {
    await service.onModuleDestroy();
  });

  it('Should skip invalid JSON', async () => {
    await kafka.send('wiki.changes', [{ value: 'oops' }]);
    await kafka.drain();

    expect(kafka.handlerErrors).toHaveLength(0);
    expect(insert).not.toHaveBeenCalled();
  });

  it('Should retry on single failed connection to DB', async () => {
    insert.mockRejectedValueOnce(new Error('db down'));
    await kafka.send('wiki.changes', [
      { value: JSON.stringify(makeEditEvent()) },
    ]);
    await kafka.drain();

    expect(kafka.handlerErrors).toHaveLength(1);
    expect(insert).toHaveBeenCalledTimes(2);
  });
});
