import type { Mock } from 'vitest';
import { InMemoryKafka } from '@app/kafka/testing';
import { StatsService } from '../../src/domain/stats.service.js';
import type { ChangesRepository } from '../../src/domain/changes.repository.js';
import { makeEditEvent } from '../fixtures.js';

describe('StatsService: POSITIVE', () => {
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

  it('Should store a valid change', async () => {
    await kafka.send('wiki.changes', [
      { value: JSON.stringify(makeEditEvent()) },
    ]);
    await kafka.drain();

    expect(insert).toHaveBeenCalledOnce();
    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({
        eventId: '2eff3ca4-683a-461d-b77e-fb1e82748e4d',
      }),
    );
  });
});
