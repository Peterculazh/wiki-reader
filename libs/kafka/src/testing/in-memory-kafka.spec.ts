import { describeKafkaContract } from './kafka.contract.js';
import { InMemoryKafka } from './in-memory-kafka.js';

describeKafkaContract('InMemoryKafka', async () => {
  const kafka = new InMemoryKafka();
  return {
    producer: kafka,
    consumers: kafka,
    reader: kafka,
    createTopic: async () => {},
    timeoutMs: 1_000,
    settleMs: 0,
    // The fake retries a failed batch only on the next send/drain
    nudge: () => kafka.drain(),
    close: async () => {},
  };
});

describe('InMemoryKafka helpers', () => {
  it('records sent messages per topic', async () => {
    const kafka = new InMemoryKafka();

    await kafka.send('t', [{ key: 'k', value: 'v' }]);

    expect(kafka.sent('t')).toMatchObject([
      { key: 'k', value: 'v', offset: '0' },
    ]);
    expect(kafka.sent('other')).toEqual([]);
  });

  it('fails the next send only, without storing it', async () => {
    const kafka = new InMemoryKafka();
    kafka.failNextSend(new Error('boom'));

    await expect(kafka.send('t', [{ value: 'lost' }])).rejects.toThrow('boom');
    await kafka.send('t', [{ value: 'kept' }]);

    expect(kafka.sent('t').map((m) => m.value)).toEqual(['kept']);
  });

  it('starts a live-only group at the end of the topic', async () => {
    const kafka = new InMemoryKafka();
    await kafka.send('t', [{ value: 'old' }]);

    const received: string[] = [];
    await kafka.subscribe({ groupId: 'g', topics: ['t'] }, async (batch) => {
      received.push(...batch.map((m) => m.value!));
    });
    await kafka.send('t', [{ value: 'new' }]);
    await kafka.drain();

    expect(received).toEqual(['new']);
  });

  it('keeps handler errors for inspection', async () => {
    const kafka = new InMemoryKafka();
    await kafka.subscribe(
      { groupId: 'g', topics: ['t'], fromBeginning: true },
      async () => {
        throw new Error('handler failed');
      },
    );

    await kafka.send('t', [{ value: 'x' }]);
    await kafka.drain();

    expect(kafka.handlerErrors).not.toHaveLength(0);
    expect(kafka.handlerErrors[0]).toMatchObject({ message: 'handler failed' });
  });
});
