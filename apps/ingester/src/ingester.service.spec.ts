import { Test } from '@nestjs/testing';
import { InMemoryKafka, overrideKafka } from '@app/kafka/testing';
import { IngesterModule } from './ingester.module.js';

// Stand-in for the Wikimedia stream: tests push events through `emit`
const streams = vi.hoisted(() => [] as FakeEventSource[]);
type FakeEventSource = {
  url: string;
  closed: boolean;
  onmessage?: (event: { data: string; lastEventId: string }) => Promise<void>;
  emit(data: string, lastEventId: string): Promise<void>;
};

vi.mock('eventsource', () => ({
  EventSource: class {
    closed = false;
    readyState = 1;
    onmessage?: FakeEventSource['onmessage'];
    constructor(public url: string) {
      streams.push(this as unknown as FakeEventSource);
    }
    emit(data: string, lastEventId: string) {
      return this.onmessage!({ data, lastEventId });
    }
    close() {
      this.closed = true;
    }
  },
}));

describe('IngesterService', () => {
  let kafka: InMemoryKafka;

  async function start() {
    const moduleRef = await overrideKafka(
      Test.createTestingModule({ imports: [IngesterModule] }),
      kafka,
    ).compile();
    const app = await moduleRef.init();
    return { app, stream: streams.at(-1)! };
  }

  beforeEach(() => {
    kafka = new InMemoryKafka();
    streams.length = 0;
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('forwards stream events to wiki.changes', async () => {
    const { app, stream } = await start();

    await stream.emit('{"id":1}', 'pos-1');
    await stream.emit('{"id":2}', 'pos-2');

    expect(kafka.sent('wiki.changes').map((m) => m.value)).toEqual([
      '{"id":1}',
      '{"id":2}',
    ]);
    await app.close();
  });

  it('creates its topics on startup, the position topic compacted', async () => {
    const { app } = await start();

    expect(kafka.topics()).toEqual(
      new Map([
        ['wiki.changes', 3],
        ['wiki.changes.latest', 1],
      ]),
    );
    expect(kafka.topicConfigs('wiki.changes')).toEqual({});
    expect(kafka.topicConfigs('wiki.changes.latest')).toEqual({
      'cleanup.policy': 'compact',
    });
    await app.close();
  });

  it('keys each event by wiki and title', async () => {
    const { app, stream } = await start();

    await stream.emit('{"wiki":"enwiki","title":"Kafka"}', 'pos-1');

    expect(kafka.sent('wiki.changes').map((m) => m.key)).toEqual([
      'enwiki:Kafka',
    ]);
    await app.close();
  });

  it('sends an event it cannot key without a key, and warns', async () => {
    const { app, stream } = await start();

    await stream.emit('not json', 'pos-1');
    await stream.emit('{"wiki":"enwiki"}', 'pos-2');
    await stream.emit('null', 'pos-3');

    expect(kafka.sent('wiki.changes').map((m) => [m.key, m.value])).toEqual([
      [null, 'not json'],
      [null, '{"wiki":"enwiki"}'],
      [null, 'null'],
    ]);
    expect(console.warn).toHaveBeenCalledTimes(3);
    await app.close();
  });

  it('stores the stream position at most once a minute', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const { app, stream } = await start();

    await stream.emit('a', 'pos-1');
    await stream.emit('b', 'pos-2');
    vi.advanceTimersByTime(60_000);
    await stream.emit('c', 'pos-3');

    expect(
      kafka.sent('wiki.changes.latest').map((m) => [m.key, m.value]),
    ).toEqual([
      ['latest', '{"latestId":"pos-1"}'],
      ['latest', '{"latestId":"pos-3"}'],
    ]);
    await app.close();
  });

  it('retries storing the position on the next event after a failed send', async () => {
    const send = kafka.send.bind(kafka);
    let failed = false;
    vi.spyOn(kafka, 'send').mockImplementation(async (topic, messages) => {
      if (topic === 'wiki.changes.latest' && !failed) {
        failed = true;
        throw new Error('broker hiccup');
      }
      return send(topic, messages);
    });
    const { app, stream } = await start();

    await stream.emit('a', 'pos-1');
    await stream.emit('b', 'pos-2');

    expect(kafka.sent('wiki.changes.latest').map((m) => m.value)).toEqual([
      '{"latestId":"pos-2"}',
    ]);
    await app.close();
  });

  it('resumes from the stored position', async () => {
    await kafka.send('wiki.changes.latest', [
      { key: 'latest', value: '{"latestId":"old"}' },
      { key: 'latest', value: '{"latestId":"newest"}' },
    ]);

    const { app } = await start();

    expect(console.log).toHaveBeenCalledWith('Resuming from newest');
    await app.close();
  });

  it('starts live when the stored position cannot be read', async () => {
    vi.spyOn(kafka, 'readAll').mockRejectedValue(new Error('broker down'));

    const { app } = await start();

    expect(console.log).toHaveBeenCalledWith(
      'No stored position, starting live',
    );
    await app.close();
  });

  it('closes the stream on shutdown', async () => {
    const { app, stream } = await start();

    await app.close();

    expect(stream.closed).toBe(true);
  });
});
