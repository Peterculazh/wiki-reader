import { toGetPageEdits } from '../../src/api/mappers/toGetPageEdits.js';

describe('toGetPageEdits', () => {
  it('Should turn database rows into the API response', () => {
    const result = toGetPageEdits(
      'ukwiki',
      'Київ',
      24,
      { edits: '5', authors: '4', bot_edits: '1', bytes_delta: '-950' },
      [
        {
          event_time: new Date('2026-11-23T12:17:37.586Z'),
          author: 'Andrii',
          bot: false,
          type: 'edit',
          bytes_delta: 100,
        },
        {
          event_time: new Date('2026-11-23T12:07:37.586Z'),
          author: 'InternetArchiveBot',
          bot: true,
          type: 'edit',
          bytes_delta: null,
        },
      ],
    );

    expect(result).toEqual({
      wiki: 'ukwiki',
      title: 'Київ',
      hours: 24,
      summary: { edits: 5, authors: 4, botEdits: 1, bytesDelta: -950 },
      edits: [
        {
          time: '2026-11-23T12:17:37.586Z',
          author: 'Andrii',
          bot: false,
          type: 'edit',
          bytesDelta: 100,
        },
        {
          time: '2026-11-23T12:07:37.586Z',
          author: 'InternetArchiveBot',
          bot: true,
          type: 'edit',
          bytesDelta: null,
        },
      ],
    });
  });
});
