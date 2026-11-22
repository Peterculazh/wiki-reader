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
import { makeEditEvent } from '../fixtures.js';

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
    await kafka.drain();

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
    await kafka.drain();

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
});
