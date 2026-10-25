import { setTimeout as sleep } from 'node:timers/promises';
import {
  CompactedTopicReader,
  IncomingMessage,
  MessageConsumerFactory,
  MessageProducer,
} from '../ports.js';

export type ContractHarness = {
  producer: MessageProducer;
  consumers: MessageConsumerFactory;
  reader: CompactedTopicReader;
  /** Creates a single-partition topic, so ordering assertions hold. */
  createTopic(name: string): Promise<void>;
  /** How long to wait for asynchronous delivery. */
  timeoutMs: number;
  /** Pause that lets a commit land after the handler resolved. */
  settleMs: number;
  /** Triggers redelivery of failed batches, for implementations that don't retry on their own. */
  nudge?(): Promise<void>;
  close(): Promise<void>;
};

/**
 * Behaviour every implementation of the ports must share. Runs against
 * InMemoryKafka in unit tests and against a real broker in e2e, so the fake
 * can't quietly drift from Kafka.
 */
export function describeKafkaContract(
  name: string,
  setup: () => Promise<ContractHarness>,
) {
  describe(`Kafka contract: ${name}`, () => {
    let h: ContractHarness;
    let topic: string;
    let seq = 0;
    const stops: (() => Promise<void>)[] = [];

    beforeAll(async () => {
      h = await setup();
    }, 60_000);

    afterAll(async () => {
      await h?.close();
    });

    beforeEach(async () => {
      topic = `contract-${Date.now()}-${seq++}`;
      await h.createTopic(topic);
    });

    afterEach(async () => {
      await Promise.all(stops.splice(0).map((stop) => stop()));
    });

    const waitFor = (assertion: () => void) =>
      vi.waitFor(assertion, { timeout: h.timeoutMs, interval: 50 });

    async function collect(groupId: string, onBatch?: () => void) {
      const received: IncomingMessage[] = [];
      const subscription = await h.consumers.subscribe(
        { groupId, topics: [topic], fromBeginning: true },
        async (batch) => {
          onBatch?.();
          received.push(...batch);
        },
      );
      stops.push(() => subscription.stop());
      return { received, subscription };
    }

    it('delivers sent messages in order with key, value and headers', async () => {
      await h.producer.send(topic, [
        { key: 'a', value: 'one', headers: { source: 'test' } },
        { value: 'two' },
      ]);
      const { received } = await collect(`${topic}-g`);

      await waitFor(() => expect(received).toHaveLength(2));
      expect(received.map((m) => [m.key, m.value])).toEqual([
        ['a', 'one'],
        [null, 'two'],
      ]);
      expect(received[0]).toMatchObject({ topic, partition: 0, offset: '0' });
      expect(received[0].headers).toEqual({ source: 'test' });
    }, 60_000);

    it('redelivers a batch whose handler threw', async () => {
      await h.producer.send(topic, [{ value: 'retry-me' }]);

      let calls = 0;
      const received: string[] = [];
      const subscription = await h.consumers.subscribe(
        { groupId: `${topic}-g`, topics: [topic], fromBeginning: true },
        async (batch) => {
          calls++;
          if (calls === 1) throw new Error('first attempt fails');
          received.push(...batch.map((m) => m.value!));
        },
      );
      stops.push(() => subscription.stop());

      await waitFor(async () => {
        await h.nudge?.();
        expect(received).toEqual(['retry-me']);
      });
      expect(calls).toBeGreaterThanOrEqual(2);
    }, 60_000);

    it('resumes a group from its committed offset', async () => {
      const groupId = `${topic}-g`;
      await h.producer.send(topic, [{ value: 'first' }]);

      const before = await collect(groupId);
      await waitFor(() => expect(before.received).toHaveLength(1));
      await sleep(h.settleMs);
      await before.subscription.stop();

      await h.producer.send(topic, [{ value: 'second' }]);
      const after = await collect(groupId);

      await waitFor(() => expect(after.received).toHaveLength(1));
      await sleep(h.settleMs);
      expect(after.received.map((m) => m.value)).toEqual(['second']);
    }, 60_000);

    it('reads the last value per key, honouring tombstones and skipping keyless records', async () => {
      await h.producer.send(topic, [
        { key: 'a', value: '1' },
        { key: 'b', value: '1' },
        { value: 'keyless' },
        { key: 'a', value: '2' },
        { key: 'b', value: null },
      ]);

      const values = await h.reader.readAll(topic);

      expect(Object.fromEntries(values)).toEqual({ a: '2' });
    }, 60_000);

    it('reads an empty topic as an empty map', async () => {
      const values = await h.reader.readAll(topic);

      expect(values.size).toBe(0);
    }, 60_000);
  });
}
