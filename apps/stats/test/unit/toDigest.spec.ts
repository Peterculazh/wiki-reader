import { toDigest } from '../../src/api/mappers/toDigest.js';
import type { DigestRow } from '../../src/domain/digest.repository.js';

function makeDigestRow(overrides: Partial<DigestRow> = {}): DigestRow {
  return {
    id: '42',
    generated_at: new Date('2026-11-24T16:29:28.443Z'),
    hours: 12,
    wikis: ['ukwiki', 'enwiki'],
    data_until: new Date('2026-11-24T16:28:56.675Z'),
    skipped_pages: 81,
    cost_usd: '0.005253',
    items: [{ wiki: 'ukwiki', title: 'Київ' }],
    ...overrides,
  };
}

describe('toDigest', () => {
  it('Should map a row to the API shape', () => {
    expect(toDigest(makeDigestRow())).toEqual({
      id: '42',
      generatedAt: '2026-11-24T16:29:28.443Z',
      hours: 12,
      wikis: ['ukwiki', 'enwiki'],
      dataUntil: '2026-11-24T16:28:56.675Z',
      skippedPages: 81,
      costUsd: 0.005253,
      items: [{ wiki: 'ukwiki', title: 'Київ' }],
    });
  });

  it('Should keep a missing dataUntil as null', () => {
    expect(toDigest(makeDigestRow({ data_until: null })).dataUntil).toBeNull();
  });
});
