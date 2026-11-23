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

describe('Stats (e2e): NEGATIVE', () => {
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

  it('Should return a 400 for not valid range', async () => {
    await request(app.getHttpServer())
      .get('/reports/edits.csv?range=foo')
      .expect(400);
  });

  it('Should return a 400 for not provided range value', async () => {
    await request(app.getHttpServer()).get('/reports/edits.csv').expect(400);
  });

  it('Should return a 400 for extra value', async () => {
    await request(app.getHttpServer())
      .get('/reports/edits.csv?range=24h&foo=1')
      .expect(400);
  });

  describe('GET /reports/page-edits', () => {
    it.each([
      ['no wiki', { title: 'Київ' }],
      ['no title', { wiki: 'ukwiki' }],
      ['an empty wiki', { wiki: '', title: 'Київ' }],
      ['an empty title', { wiki: 'ukwiki', title: '' }],
      ['hours below 1', { wiki: 'ukwiki', title: 'Київ', hours: 0 }],
      ['hours above 24', { wiki: 'ukwiki', title: 'Київ', hours: 25 }],
      [
        'hours that is not a number',
        { wiki: 'ukwiki', title: 'Київ', hours: 'abc' },
      ],
      ['limit below 1', { wiki: 'ukwiki', title: 'Київ', limit: 0 }],
      ['limit above 50', { wiki: 'ukwiki', title: 'Київ', limit: 51 }],
    ])('Should return a 400 for %s', async (_, query) => {
      await request(app.getHttpServer())
        .get('/reports/page-edits')
        .query(query)
        .expect(400);
    });
  });
});
