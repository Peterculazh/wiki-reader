import type { Mock } from 'vitest';
import { InMemoryKafka } from '@app/kafka/testing';
import { StatsService } from '../../src/domain/stats.service.js';
import type { ChangesRepository } from '../../src/domain/changes.repository.js';
import { makeEditEvent } from '../fixtures.js';

describe('StatsService: restart', () => {
  it('Should not reprocess or lose messages after a restart', async () => {
    const kafka = new InMemoryKafka();
    const insert: Mock<ChangesRepository['insert']> = vi
      .fn<ChangesRepository['insert']>()
      .mockResolvedValue(undefined);
    const repo = { insert } as unknown as ChangesRepository;
    const eventWithId = (id: string) =>
      JSON.stringify(makeEditEvent({ meta: { ...makeEditEvent().meta, id } }));

    const first = new StatsService(kafka, repo);
    await first.onModuleInit();
    await kafka.send('wiki.changes', [{ value: eventWithId('m0') }]);
    await kafka.drain();
    await first.onModuleDestroy();

    await kafka.send('wiki.changes', [{ value: eventWithId('m1') }]);

    const second = new StatsService(kafka, repo);
    await second.onModuleInit();
    await kafka.drain();
    await second.onModuleDestroy();

    expect(insert.mock.calls.map(([change]) => change.eventId)).toEqual([
      'm0',
      'm1',
    ]);
  });
});
