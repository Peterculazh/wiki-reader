import { setTimeout as sleep } from 'node:timers/promises';
import {
  CompactedTopicReader,
  IncomingMessage,
  MessageConsumerFactory,
  MessageContext,
  MessageProducer,
  TopicPartition,
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

    async function collectChunks(
      groupId: string,
      chunking: { batchSize?: number; maxWaitMs?: number },
      failFirst = false,
    ) {
      const chunks: string[][] = [];
      let calls = 0;
      const subscription = await h.consumers.subscribe(
        { groupId, topics: [topic], fromBeginning: true, ...chunking },
        async (chunk) => {
          if (calls++ === 0 && failFirst) throw new Error('first chunk fails');
          chunks.push(chunk.map((m) => m.value!));
        },
      );
      stops.push(() => subscription.stop());
      return { chunks, subscription };
    }

    const values = (prefix: string, n: number) =>
      Array.from({ length: n }, (_, i) => ({ value: `${prefix}${i}` }));

    it('hands the handler exact batchSize chunks and keeps the remainder buffered', async () => {
      await h.producer.send(topic, values('m', 7));

      const { chunks } = await collectChunks(`${topic}-g`, { batchSize: 3 });

      await waitFor(() => expect(chunks).toHaveLength(2));
      await sleep(h.settleMs);
      expect(chunks).toEqual([
        ['m0', 'm1', 'm2'],
        ['m3', 'm4', 'm5'],
      ]);
    }, 60_000);

    it('flushes a partial chunk once maxWaitMs passes', async () => {
      await h.producer.send(topic, values('m', 2));

      const { chunks } = await collectChunks(`${topic}-g`, {
        batchSize: 100,
        maxWaitMs: 300,
      });

      await waitFor(() => expect(chunks).toEqual([['m0', 'm1']]));
    }, 60_000);

    it('redelivers a failed chunk whole, from its first offset', async () => {
      await h.producer.send(topic, values('m', 4));

      const { chunks } = await collectChunks(
        `${topic}-g`,
        { batchSize: 2 },
        true,
      );

      await waitFor(async () => {
        await h.nudge?.();
        expect(chunks).toEqual([
          ['m0', 'm1'],
          ['m2', 'm3'],
        ]);
      });
    }, 60_000);

    it('commits only flushed chunks, so a new member re-reads the buffered remainder', async () => {
      const groupId = `${topic}-g`;
      await h.producer.send(topic, values('m', 4));

      const before = await collectChunks(groupId, { batchSize: 3 });
      await waitFor(() => expect(before.chunks).toHaveLength(1));
      await sleep(h.settleMs);
      await before.subscription.stop();

      const after = await collect(groupId);
      await waitFor(() => expect(after.received).toHaveLength(1));
      await sleep(h.settleMs);
      expect(after.received.map((m) => m.value)).toEqual(['m3']);
    }, 60_000);

    async function collectEach(
      groupId: string,
      onMessage?: (
        message: IncomingMessage,
        context: MessageContext,
      ) => Promise<void>,
      onRevoked?: (partitions: TopicPartition[]) => void,
    ) {
      const seen: string[] = [];
      const subscription = await h.consumers.subscribeEach(
        { groupId, topics: [topic], fromBeginning: true, onRevoked },
        async (message, context) => {
          await onMessage?.(message, context);
          seen.push(message.value!);
        },
      );
      stops.push(() => subscription.stop());
      return { seen, subscription };
    }

    it('subscribeEach delivers every message individually, in order', async () => {
      await h.producer.send(topic, values('m', 3));
      const offsets: string[] = [];

      const { seen } = await collectEach(`${topic}-g`, async (message) => {
        offsets.push(message.offset);
      });

      await waitFor(() => expect(seen).toEqual(['m0', 'm1', 'm2']));
      expect(offsets).toEqual(['0', '1', '2']);
    }, 60_000);

    it('subscribeEach redelivers a message whose handler threw', async () => {
      await h.producer.send(topic, values('m', 2));
      let failed = false;

      const { seen } = await collectEach(`${topic}-g`, async (message) => {
        if (message.value === 'm1' && !failed) {
          failed = true;
          throw new Error('m1 fails once');
        }
      });

      await waitFor(async () => {
        await h.nudge?.();
        expect(seen).toEqual(['m0', 'm1']);
      });
    }, 60_000);

    it('subscribeEach commits only what the app commits', async () => {
      const groupId = `${topic}-g`;
      await h.producer.send(topic, values('m', 4));

      const before = await collectEach(groupId, async (message, context) => {
        if (message.value === 'm1') await context.commit(message);
      });
      await waitFor(() => expect(before.seen).toHaveLength(4));
      await sleep(h.settleMs);
      await before.subscription.stop();

      const after = await collectEach(groupId);
      await waitFor(() => expect(after.seen).toHaveLength(2));
      await sleep(h.settleMs);
      expect(after.seen).toEqual(['m2', 'm3']);
    }, 60_000);

    it('subscribeEach rewind re-reads the partition from the given offset', async () => {
      await h.producer.send(topic, values('m', 4));
      let first: IncomingMessage | undefined;
      let rewound = false;

      const { seen } = await collectEach(
        `${topic}-g`,
        async (message, context) => {
          first ??= message;
          // Pretend the buffered m0..m2 failed to store: start over from m0
          if (message.value === 'm3' && !rewound) {
            rewound = true;
            context.rewind(first);
            throw new Error('stop here, m3 comes again after the rewind');
          }
        },
      );

      await waitFor(async () => {
        await h.nudge?.();
        expect(seen).toEqual(['m0', 'm1', 'm2', 'm0', 'm1', 'm2', 'm3']);
      });
    }, 60_000);

    it('subscribeEach reports owned partitions as revoked on stop', async () => {
      await h.producer.send(topic, values('m', 1));
      const revoked: TopicPartition[][] = [];

      const { seen, subscription } = await collectEach(
        `${topic}-g`,
        undefined,
        (partitions) => revoked.push(partitions),
      );
      await waitFor(() => expect(seen).toEqual(['m0']));
      await subscription.stop();

      expect(revoked).toEqual([[{ topic, partition: 0 }]]);
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
