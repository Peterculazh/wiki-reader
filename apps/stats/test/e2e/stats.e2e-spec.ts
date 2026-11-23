import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { Pool } from 'pg';
import { DB_POOL } from '@app/postgres';
import { InMemoryKafka, overrideKafka } from '@app/kafka/testing';
import { StatsModule } from '../../src/stats.module.js';
import { configureApp } from '../../src/configure-app.js';
import { startTestDatabase } from '../postgres.js';
import { makeChange, makeEditEvent } from '../fixtures.js';
import {
  type ChangeCreate,
  ChangesRepository,
} from '../../src/domain/changes.repository.js';

function minutesAgo(minutes: number): string {
  return new Date(Date.now() - minutes * 60_000).toISOString();
}

describe('Stats (e2e): POSITIVE', () => {
  let db: Awaited<ReturnType<typeof startTestDatabase>>;
  let kafka: InMemoryKafka;
  let app: INestApplication<App>;

  beforeAll(async () => {
    db = await startTestDatabase();
    kafka = new InMemoryKafka();

    const moduleRef = await overrideKafka(
      Test.createTestingModule({ imports: [StatsModule] }),
      kafka,
    )
      .overrideProvider(DB_POOL)
      .useFactory({ factory: () => new Pool({ connectionString: db.url }) })
      .compile();

    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    await db?.stop();
  });

  beforeEach(async () => {
    await db.pool.query('TRUNCATE changes');
  });

  async function waitForStoredChanges(count: number) {
    await vi.waitFor(
      async () => {
        const { rows } = await db.pool.query('SELECT count(*) FROM changes');
        expect(rows[0].count).toBe(String(count));
      },
      { timeout: 5_000, interval: 100 },
    );
  }

  it('Should return a 24-hour report as CSV', async () => {
    const res = await request(app.getHttpServer())
      .get('/reports/edits.csv?range=24h')
      .expect(200);

    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.text.trim().split('\r\n')).toHaveLength(25);
  });

  it('Should return a 7 day report as CSV', async () => {
    const res = await request(app.getHttpServer())
      .get('/reports/edits.csv?range=7d')
      .expect(200);

    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.text.trim().split('\r\n')).toHaveLength(8);
  });

  it('Should count an edit that came through Kafka', async () => {
    const now = new Date();
    const event = makeEditEvent({
      meta: { ...makeEditEvent().meta, dt: now.toISOString() },
    });

    await kafka.send('wiki.changes', [{ value: JSON.stringify(event) }]);
    await waitForStoredChanges(1);

    const res = await request(app.getHttpServer())
      .get('/reports/edits.csv?range=24h')
      .expect(200);

    const hour = new Date(now);
    hour.setUTCMinutes(0, 0, 0);
    const line = res.text
      .split('\r\n')
      .find((row) => row.startsWith(hour.toISOString()));
    expect(line?.split(',')[1]).toBe('1');
  });

  it(`Shouldn't fail on first not valid edit that came through Kafka`, async () => {
    const now = new Date();
    const event = makeEditEvent({
      meta: { ...makeEditEvent().meta, dt: now.toISOString() },
    });

    await kafka.send('wiki.changes', [{ value: 'oops' }]);
    await kafka.send('wiki.changes', [{ value: JSON.stringify(event) }]);
    await waitForStoredChanges(1);

    const res = await request(app.getHttpServer())
      .get('/reports/edits.csv?range=24h')
      .expect(200);

    const hour = new Date(now);
    hour.setUTCMinutes(0, 0, 0);
    const line = res.text
      .split('\r\n')
      .find((row) => row.startsWith(hour.toISOString()));
    expect(line?.split(',')[1]).toBe('1');
  });

  it('Should return a 7 day report in JSON', async () => {
    const res = await request(app.getHttpServer())
      .get('/reports/edits?range=7d')
      .expect(200);

    expect(res.headers['content-type']).toContain('application/json');
    expect(res.body).toBeTruthy();
    expect(res.body.range).toBe('7d');
    expect(res.body.unit).toBe('day');
    expect(Array.isArray(res.body.buckets)).toBeTruthy();
  });

  describe('GET /reports/page-edits', () => {
    const seed = (...changes: ChangeCreate[]) =>
      new ChangesRepository(db.pool).insertMany(changes);

    it('Should return the summary and the latest edits of a page', async () => {
      const newer = minutesAgo(10);
      const older = minutesAgo(20);
      await seed(
        makeChange({
          wiki: 'ukwiki',
          title: 'Київ',
          author: 'Andrii',
          eventTime: newer,
          length_old: 1000,
          length_new: 1100,
        }),
        makeChange({
          wiki: 'ukwiki',
          title: 'Київ',
          author: 'Bohdan',
          eventTime: older,
          length_old: 1100,
          length_new: 800,
        }),
        // Outside hours=2, inside limit=10: catches hours and limit mixed up
        makeChange({
          wiki: 'ukwiki',
          title: 'Київ',
          author: 'Old',
          eventTime: minutesAgo(180),
        }),
      );

      const res = await request(app.getHttpServer())
        .get('/reports/page-edits')
        .query({ wiki: 'ukwiki', title: 'Київ', hours: 2, limit: 10 })
        .expect(200);

      expect(res.body).toEqual({
        wiki: 'ukwiki',
        title: 'Київ',
        hours: 2,
        summary: { edits: 2, authors: 2, botEdits: 0, bytesDelta: -200 },
        edits: [
          {
            time: newer,
            author: 'Andrii',
            bot: false,
            type: 'edit',
            bytesDelta: 100,
          },
          {
            time: older,
            author: 'Bohdan',
            bot: false,
            type: 'edit',
            bytesDelta: -300,
          },
        ],
      });
    });

    it('Should count every edit but list only 20 by default', async () => {
      await seed(
        ...Array.from({ length: 21 }, (_, i) =>
          makeChange({
            wiki: 'ukwiki',
            title: 'Київ',
            eventTime: minutesAgo(i + 1),
          }),
        ),
      );

      const res = await request(app.getHttpServer())
        .get('/reports/page-edits')
        .query({ wiki: 'ukwiki', title: 'Київ' })
        .expect(200);

      expect(res.body.hours).toBe(24);
      expect(res.body.summary.edits).toBe(21);
      expect(res.body.edits).toHaveLength(20);
    });

    it('Should return zeros, not 404, for a page without edits', async () => {
      const res = await request(app.getHttpServer())
        .get('/reports/page-edits')
        .query({ wiki: 'ukwiki', title: 'Ужгород' })
        .expect(200);

      expect(res.body.summary).toEqual({
        edits: 0,
        authors: 0,
        botEdits: 0,
        bytesDelta: 0,
      });
      expect(res.body.edits).toEqual([]);
    });
  });

  describe('GET /reports/status', () => {
    it('Should return when the newest data is from and how long ago it was', async () => {
      const newest = minutesAgo(10.5);
      await new ChangesRepository(db.pool).insertMany([
        makeChange({ eventTime: minutesAgo(30) }),
        makeChange({ eventTime: newest }),
      ]);

      const res = await request(app.getHttpServer())
        .get('/reports/status')
        .expect(200);

      expect(res.body).toEqual({ dataUntil: newest, minutesBehind: 10 });
    });

    it('Should return nulls when there is no data', async () => {
      const res = await request(app.getHttpServer())
        .get('/reports/status')
        .expect(200);

      expect(res.body).toEqual({ dataUntil: null, minutesBehind: null });
    });
  });
});
