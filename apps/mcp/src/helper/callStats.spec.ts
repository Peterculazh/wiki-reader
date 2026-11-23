import { afterEach, describe, expect, it, vi } from 'vitest';
import { callStats } from './callStats.js';

const STATUS = { dataUntil: '2026-11-23T07:14:51.819Z', minutesBehind: 366 };

// A fake stats API: /reports/status answers with STATUS, any other path with `data`
function mockStats(data: () => Promise<Response>) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL | Request) =>
      String(input).endsWith('/reports/status')
        ? Response.json(STATUS)
        : data(),
    ),
  );
}

describe('callStats', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('Should put the data status first, then the data', async () => {
    mockStats(async () => Response.json({ hours: 1, pages: [] }));

    const result = await callStats('/reports/top-pages?hours=1');

    expect(result).toEqual({
      content: [
        {
          type: 'text',
          text: JSON.stringify({ ...STATUS, hours: 1, pages: [] }),
        },
      ],
    });
  });

  it('Should show the model why stats rejected the call', async () => {
    mockStats(
      async () =>
        new Response('{"message":["title should not be empty"]}', {
          status: 400,
        }),
    );

    const result = await callStats('/reports/page-edits?wiki=ukwiki&title=');

    expect(result).toEqual({
      isError: true,
      content: [
        {
          type: 'text',
          text: 'stats responded with 400: {"message":["title should not be empty"]}',
        },
      ],
    });
  });

  it('Should return an error instead of throwing when stats is down', async () => {
    mockStats(async () => {
      throw new TypeError('fetch failed');
    });

    const result = await callStats('/reports/top-pages?hours=1');

    expect(result).toEqual({
      isError: true,
      content: [{ type: 'text', text: 'fetch failed' }],
    });
  });
});
