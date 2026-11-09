import type { INestApplication, MessageEvent } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { InMemoryKafka, overrideKafka } from '@app/kafka/testing';
import type {
  BurstEvent,
  LiveEdit,
  LiveStreamEventName,
  LiveStreamEvents,
} from '@app/contracts';
import { API_CONFIG, apiConfigFromEnv, type ApiConfig } from './api.config.js';
import { ApiModule, configureApi } from './api.module.js';
import { LiveController } from './live.controller.js';
import { type EditFilter, LiveFeedService } from './live-feed.service.js';

// Short intervals, so a test waits milliseconds for a batch instead of seconds
const config: ApiConfig = {
  ...apiConfigFromEnv({}),
  batchMs: 20,
  statsIntervalMs: 50,
};

let nextId = 1;
const change = (overrides: Record<string, unknown> = {}) => {
  const id = nextId++;
  return {
    key: 'enwiki:Some_page',
    value: JSON.stringify({
      meta: {
        id: `event-${id}`,
        dt: new Date().toISOString(),
        domain: 'en.wikipedia.org',
      },
      type: 'edit',
      namespace: 0,
      title: 'Some page',
      title_url: 'https://en.wikipedia.org/wiki/Some_page',
      comment: '',
      user: 'Alice',
      bot: false,
      length: { old: 100, new: 110 },
      revision: { old: id, new: id + 1 },
      server_url: 'https://en.wikipedia.org',
      server_name: 'en.wikipedia.org',
      server_script_path: '/w',
      wiki: 'enwiki',
      ...overrides,
    }),
  };
};

const burst = (title: string, detectedAt = new Date().toISOString()) => {
  const value: BurstEvent = {
    burstId: `enwiki:${title}:${detectedAt}`,
    wiki: 'enwiki',
    title,
    serverUrl: 'https://en.wikipedia.org',
    titleUrl: `https://en.wikipedia.org/wiki/${title}`,
    authors: 3,
    users: ['Alice', 'Bob', 'Carol'],
    editCount: 3,
    windowStart: detectedAt,
    windowEnd: detectedAt,
    revisions: [],
    detectedAt,
  };
  return { key: `enwiki:${title}`, value: JSON.stringify(value) };
};

/** Subscribes to one stream the way a GET /live connection does */
function openStream(app: INestApplication, filter: EditFilter = {}) {
  const events: MessageEvent[] = [];
  let completed = false;
  const subscription = app
    .get(LiveFeedService)
    .stream(filter)
    .subscribe({
      next: (event) => events.push(event),
      complete: () => (completed = true),
    });
  return {
    events,
    subscription,
    isCompleted: () => completed,
    of: <K extends LiveStreamEventName>(type: K) =>
      events
        .filter((event) => event.type === type)
        .map((event) => event.data as LiveStreamEvents[K]),
  };
}

/** Reads one server-sent event at a time from a fetch response */
function sseReader(response: Response) {
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  const next = async (): Promise<{ event: string; data: any }> => {
    for (;;) {
      const end = buffer.indexOf('\n\n');
      if (end >= 0) {
        const lines = buffer.slice(0, end).split('\n');
        buffer = buffer.slice(end + 2);
        const data = lines
          .filter((line) => line.startsWith('data:'))
          .map((line) => line.slice(5).trimStart())
          .join('\n');
        if (data === '') continue;
        const event =
          lines
            .find((line) => line.startsWith('event:'))
            ?.slice(6)
            .trim() ?? 'message';
        return { event, data: JSON.parse(data) };
      }
      const { value, done } = await reader.read();
      if (done) throw new Error('The stream ended');
      buffer += decoder.decode(value, { stream: true });
    }
  };

  const nextOf = async (event: string) => {
    for (;;) {
      const received = await next();
      if (received.event === event) return received;
    }
  };

  return { next, nextOf };
}

describe('LiveFeedService', () => {
  let kafka: InMemoryKafka;
  let apps: INestApplication[];

  async function start() {
    const moduleRef = await overrideKafka(
      Test.createTestingModule({ imports: [ApiModule] }),
      kafka,
    )
      .overrideProvider(API_CONFIG)
      .useValue(config)
      .compile();
    const app = configureApi(
      moduleRef.createNestApplication({ logger: false }),
    );
    apps.push(app);
    return app.init();
  }

  beforeEach(() => {
    kafka = new InMemoryKafka();
    apps = [];
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(async () => {
    await Promise.all(apps.map((app) => app.close()));
    vi.restoreAllMocks();
  });

  it('creates wiki.changes and wiki.bursts with their partition counts', async () => {
    await start();

    expect(kafka.topics()).toEqual(
      new Map([
        ['wiki.changes', 3],
        ['wiki.bursts', 6],
      ]),
    );
  });

  it('gives every instance its own consumer groups and never auto-commits', async () => {
    const subscribeEach = vi.spyOn(kafka, 'subscribeEach');
    await start();
    await start();

    const options = subscribeEach.mock.calls.map(([o]) => o);
    // Shared groups would split the partitions between the instances
    expect(new Set(options.map((o) => o.groupId)).size).toBe(4);
    expect(options.every((o) => !o.autoCommit)).toBe(true);
    expect(
      options.map((o) => [o.topics.join(), o.fromBeginning]).slice(0, 2),
    ).toEqual([
      ['wiki.changes', false],
      ['wiki.bursts', true],
    ]);
  });

  it('serves the bursts already on wiki.bursts, newest first, each once', async () => {
    const older = burst('Older', '2026-11-07T12:00:00.000Z');
    await kafka.send('wiki.bursts', [
      older,
      burst('Newer', '2026-11-07T12:05:00.000Z'),
      older,
    ]);

    const app = await start();
    await kafka.drain();

    expect(
      app
        .get(LiveController)
        .bursts(50)
        .map((b) => b.title),
    ).toEqual(['Newer', 'Older']);
  });

  it('counts only the edits that arrive after it started', async () => {
    await kafka.send('wiki.changes', [change()]);

    const app = await start();
    await kafka.drain();
    await kafka.send('wiki.changes', [change({ wiki: 'dewiki' })]);
    await kafka.drain();

    expect(app.get(LiveController).stats().topWikis).toEqual([
      { wiki: 'dewiki', edits: 1 },
    ]);
  });

  it('streams new edits in batches, filtered by wiki and bots', async () => {
    const app = await start();
    const stream = openStream(app, {
      wikis: new Set(['enwiki']),
      bots: false,
    });

    await kafka.send('wiki.changes', [
      change({ title: 'Wanted' }),
      change({ title: 'By a bot', bot: true }),
      change({ title: 'Elsewhere', wiki: 'dewiki' }),
      change({ title: 'A log entry', type: 'log' }),
    ]);
    await kafka.drain();

    await vi.waitFor(() => expect(stream.of('edits')).toHaveLength(1));
    expect(stream.of('edits')[0].map((edit: LiveEdit) => edit.title)).toEqual([
      'Wanted',
    ]);
  });

  it('sends each new burst once', async () => {
    const app = await start();
    await kafka.drain();
    const stream = openStream(app);

    const hot = burst('Hot');
    await kafka.send('wiki.bursts', [hot, hot, burst('Hotter')]);
    await kafka.drain();

    expect(stream.of('burst').map((b) => b.title)).toEqual(['Hot', 'Hotter']);
  });

  it('sends stats right after connecting and then on every interval', async () => {
    const app = await start();
    const stream = openStream(app);

    await vi.waitFor(() =>
      expect(stream.of('stats').length).toBeGreaterThan(2),
    );
    expect(stream.events[0].type).toBe('stats');
  });

  it('skips malformed messages and keeps consuming', async () => {
    const app = await start();

    await kafka.send('wiki.changes', [{ value: 'not json' }, change()]);
    await kafka.send('wiki.bursts', [{ value: '{}' }, burst('Hot')]);
    await kafka.drain();

    expect(kafka.handlerErrors).toEqual([]);
    expect(console.warn).toHaveBeenCalledTimes(2);
    expect(app.get(LiveController).stats().topWikis).toEqual([
      { wiki: 'enwiki', edits: 1 },
    ]);
    expect(app.get(LiveController).bursts(50)).toHaveLength(1);
  });

  it('ends every open stream on shutdown, and any stream opened after it', async () => {
    const app = await start();
    const open = openStream(app);

    await app.close();
    apps = apps.filter((other) => other !== app);
    const late = openStream(app);

    expect(open.isCompleted()).toBe(true);
    expect(late.isCompleted()).toBe(true);
    expect(late.events).toEqual([]);
  });

  describe('over HTTP', () => {
    async function listen() {
      const app = await start();
      await app.listen(0, '127.0.0.1');
      return app.getUrl();
    }

    it('serves GET /live as server-sent events, with CORS for the dashboard', async () => {
      const url = await listen();
      const abort = new AbortController();

      const response = await fetch(`${url}/live?wiki=enwiki`, {
        headers: { Origin: 'http://localhost:3000' },
        signal: abort.signal,
      });
      const events = sseReader(response);

      expect(response.headers.get('content-type')).toMatch(
        /^text\/event-stream/,
      );
      expect(response.headers.get('access-control-allow-origin')).toBe(
        'http://localhost:3000',
      );
      expect((await events.next()).event).toBe('stats');

      await kafka.send('wiki.changes', [
        change({ title: 'Elsewhere', wiki: 'dewiki' }),
        change({ title: 'Live' }),
      ]);
      await kafka.drain();
      const { data } = await events.nextOf('edits');

      expect(data.map((edit: LiveEdit) => edit.title)).toEqual(['Live']);
      abort.abort();
    });

    it('serves GET /bursts and GET /stats as JSON', async () => {
      await kafka.send('wiki.bursts', [burst('Hot')]);
      const url = await listen();
      await kafka.drain();

      const bursts = await fetch(`${url}/bursts?limit=1`);
      const stats = await fetch(`${url}/stats`);

      expect((await bursts.json()).map((b: BurstEvent) => b.title)).toEqual([
        'Hot',
      ]);
      expect(await stats.json()).toMatchObject({
        windowMinutes: 60,
        topWikis: [],
      });
    });

    it.each([
      ['/live?bots=maybe'],
      ['/bursts?limit=0'],
      ['/bursts?limit=many'],
    ])('rejects GET %s with 400', async (path) => {
      const url = await listen();

      const response = await fetch(`${url}${path}`);

      expect(response.status).toBe(400);
    });
  });
});
