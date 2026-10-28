import { Test } from '@nestjs/testing';
import { InMemoryKafka, overrideKafka } from '@app/kafka/testing';
import { BurstsModule } from './bursts.module.js';

// Recent by the wall clock, or the bursts would count as stale
const T0 = Date.now() - 5 * 60_000;
let nextRev = 1;

const edit = (title: string, user: string, minute: number, base = T0) => ({
  value: JSON.stringify({
    meta: {
      domain: 'en.wikipedia.org',
      dt: new Date(base + minute * 60_000).toISOString(),
    },
    type: 'edit',
    namespace: 0,
    bot: false,
    wiki: 'enwiki',
    title,
    title_url: `https://en.wikipedia.org/wiki/${title}`,
    server_url: 'https://en.wikipedia.org',
    user,
    revision: { new: nextRev++ },
  }),
});

const burstOn = (title: string, base = T0) => [
  edit(title, 'Alice', 0, base),
  edit(title, 'Bob', 1, base),
  edit(title, 'Carol', 2, base),
];

describe('BurstsService', () => {
  let kafka: InMemoryKafka;

  async function start() {
    const moduleRef = await overrideKafka(
      Test.createTestingModule({ imports: [BurstsModule] }),
      kafka,
    ).compile();
    return moduleRef.init();
  }

  beforeEach(() => {
    kafka = new InMemoryKafka();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('creates wiki.bursts with 6 partitions on startup', async () => {
    const app = await start();

    expect(kafka.topics().get('wiki.bursts')).toBe(6);
    await app.close();
  });

  it('publishes one burst, keyed by page, once three humans edited it', async () => {
    const app = await start();

    await kafka.send('wiki.changes', [
      ...burstOn('Some_page'),
      edit('Some_page', 'Dave', 3),
    ]);
    await kafka.drain();

    const sent = kafka.sent('wiki.bursts');
    expect(sent.map((m) => m.key)).toEqual(['enwiki:Some_page']);
    expect(JSON.parse(sent[0].value!)).toMatchObject({
      burstId: `enwiki:Some_page:${new Date(T0).toISOString()}`,
      authors: 3,
      users: ['Alice', 'Bob', 'Carol'],
    });
    await app.close();
  });

  it('skips a malformed message and keeps consuming', async () => {
    const app = await start();

    await kafka.send('wiki.changes', [
      { value: 'not json' },
      ...burstOn('Some_page'),
    ]);
    await kafka.drain();

    expect(kafka.handlerErrors).toEqual([]);
    expect(kafka.sent('wiki.bursts')).toHaveLength(1);
    expect(console.warn).toHaveBeenCalledOnce();
    await app.close();
  });

  it('logs a failed publish and keeps going', async () => {
    const send = kafka.send.bind(kafka);
    let failed = false;
    vi.spyOn(kafka, 'send').mockImplementation(async (topic, messages) => {
      if (topic === 'wiki.bursts' && !failed) {
        failed = true;
        throw new Error('broker hiccup');
      }
      return send(topic, messages);
    });
    const app = await start();

    await kafka.send('wiki.changes', [
      ...burstOn('First_page'),
      ...burstOn('Second_page'),
    ]);
    await kafka.drain();

    expect(console.error).toHaveBeenCalledOnce();
    expect(kafka.handlerErrors).toEqual([]);
    expect(kafka.sent('wiki.bursts').map((m) => m.key)).toEqual([
      'enwiki:Second_page',
    ]);
    await app.close();
  });

  it('does not publish bursts from a backlog that is hours old', async () => {
    const app = await start();
    const twoHoursAgo = Date.now() - 2 * 60 * 60_000;

    // E.g. the ingester replaying from its stored position
    await kafka.send('wiki.changes', [
      ...burstOn('Old_page', twoHoursAgo),
      ...burstOn('Live_page'),
    ]);
    await kafka.drain();

    expect(kafka.sent('wiki.bursts').map((m) => m.key)).toEqual([
      'enwiki:Live_page',
    ]);
    await app.close();
    expect(console.log).toHaveBeenCalledWith(
      expect.stringContaining('1 bursts emitted, 1 stale bursts skipped'),
    );
  });

  it('ignores what was on wiki.changes before it started', async () => {
    await kafka.send('wiki.changes', burstOn('Old_page'));

    const app = await start();
    await kafka.drain();

    expect(kafka.sent('wiki.bursts')).toEqual([]);
    await app.close();
  });
});
