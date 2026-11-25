import {
  DigestRepository,
  type DigestCreate,
} from '../../src/domain/digest.repository.js';
import { startTestDatabase } from '../postgres.js';

export function makeDigest(
  overrides: Partial<DigestCreate> = {},
): DigestCreate {
  return {
    generatedAt: '2026-11-24T16:29:28.443Z',
    hours: 12,
    wikis: ['ukwiki', 'enwiki'],
    dataUntil: '2026-11-24T16:28:56.675Z',
    skippedPages: 81,
    costUsd: 0.005253,
    items: [
      {
        wiki: 'ukwiki',
        title: 'Іриней (Булович)',
        edits: 5,
        authors: 5,
        verdict: {
          category: 'news_or_event',
          confidence: 'low',
          summary: '5 edits by 5 different authors within about three hours.',
          evidence: [
            'Summary: 5 edits, 5 distinct authors, 0 bot edits, bytesDelta +344 over 12 hours.',
          ],
        },
      },
      {
        wiki: 'enwiki',
        title: 'Teresa Buczacki',
        edits: 45,
        authors: 4,
        verdict: {
          category: 'single_author',
          confidence: 'high',
          summary: 'Physics Sci made 39 of the 45 edits in the last 12 hours.',
          evidence: [
            'Summary: 45 edits, 4 distinct authors, 0 bot edits, net bytesDelta +3940.',
          ],
        },
      },
      {
        wiki: 'enwiki',
        title: '2027 Punjab Legislative Assembly election',
        edits: 50,
        authors: 11,
        error: 'stats responded with 500: Internal Server Error',
      },
    ],
    ...overrides,
  };
}

describe('DigestRepository', () => {
  let db: Awaited<ReturnType<typeof startTestDatabase>>;
  let repo: DigestRepository;

  beforeAll(async () => {
    db = await startTestDatabase();
    repo = new DigestRepository(db.pool);
  }, 60_000);

  afterAll(async () => {
    await db?.stop();
  });

  beforeEach(async () => {
    await db.pool.query('TRUNCATE digests');
  });

  it('Should save digest', async () => {
    const digest = makeDigest();
    await repo.save(digest);

    const { rows } = await db.pool.query('SELECT count(*) FROM digests');
    expect(rows[0].count).toBe('1');
  });

  it('Should save two digest and retrive latest', async () => {
    const latestDigest = makeDigest({
      generatedAt: '2026-11-24T16:00:00.000Z',
    });
    await repo.save(latestDigest);
    await repo.save(makeDigest({ generatedAt: '2026-11-24T04:00:00.000Z' }));

    const digest = await repo.findLatest();
    expect(digest).toBeTruthy();
    expect(digest?.generated_at.toISOString()).toBe(latestDigest.generatedAt);
  });

  it(`Should save and read digest`, async () => {
    const digest = makeDigest();
    await repo.save(digest);

    expect(await repo.findLatest()).toEqual({
      id: expect.any(String),
      generated_at: new Date('2026-11-24T16:29:28.443Z'),
      hours: 12,
      wikis: ['ukwiki', 'enwiki'],
      data_until: new Date('2026-11-24T16:28:56.675Z'),
      skipped_pages: 81,
      cost_usd: '0.005253',
      items: digest.items,
    });
  });
});
