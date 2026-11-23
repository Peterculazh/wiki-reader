import {
  ChangesReportRow,
  ChangesRepository,
} from '../../src/domain/changes.repository.js';
import { makeChange } from '../fixtures.js';
import { startTestDatabase } from '../postgres.js';

function hourStartAgo(hours: number): Date {
  const date = new Date();
  date.setUTCMinutes(0, 0, 0);
  date.setUTCHours(date.getUTCHours() - hours);
  return date;
}

function dayStartAgo(days: number): Date {
  const date = new Date();
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCDate(date.getUTCDate() - days);
  return date;
}

function minutesAfter(date: Date, minutes: number): string {
  return new Date(date.getTime() + minutes * 60_000).toISOString();
}

function rowAt(rows: ChangesReportRow[], periodStart: Date) {
  return rows.find(
    (row) => row.period_start.getTime() === periodStart.getTime(),
  );
}

function minutesAgo(minutes: number): string {
  return new Date(Date.now() - minutes * 60_000).toISOString();
}

describe('ChangesRepository', () => {
  let db: Awaited<ReturnType<typeof startTestDatabase>>;
  let repo: ChangesRepository;

  beforeAll(async () => {
    db = await startTestDatabase();
    repo = new ChangesRepository(db.pool);
  }, 60_000);

  afterAll(async () => {
    await db?.stop();
  });

  beforeEach(async () => {
    await db.pool.query('TRUNCATE changes');
  });

  it('Should store the same change only once', async () => {
    const change = makeChange();

    await repo.insert(change);
    await repo.insert(change);

    const { rows } = await db.pool.query('SELECT count(*) FROM changes');
    expect(rows[0].count).toBe('1');
  });

  it('Should store every field of a change', async () => {
    await repo.insert(
      makeChange({
        eventId: '2eff3ca4-683a-461d-b77e-fb1e82748e4d',
        eventTime: '2026-11-19T12:30:00.000Z',
        wiki: 'enwiki',
        title: 'Coffee',
        type: 'edit',
        author: 'Someone',
        namespace: 0,
        bot: true,
        length_old: 1000,
        length_new: 1100,
      }),
    );

    const { rows } = await db.pool.query('SELECT * FROM changes');

    expect(rows).toEqual([
      {
        event_id: '2eff3ca4-683a-461d-b77e-fb1e82748e4d',
        event_time: new Date('2026-11-19T12:30:00.000Z'),
        wiki: 'enwiki',
        title: 'Coffee',
        type: 'edit',
        author: 'Someone',
        namespace: 0,
        bot: true,
        length_old: 1000,
        length_new: 1100,
        ingested_at: expect.any(Date),
      },
    ]);
  });

  it('Should store two different changes', async () => {
    await repo.insert(makeChange());
    await repo.insert(makeChange());

    const { rows } = await db.pool.query('SELECT count(*) FROM changes');
    expect(rows[0].count).toBe('2');
  });

  describe('insertMany', () => {
    it('Should store every change of a chunk', async () => {
      await repo.insertMany([makeChange(), makeChange(), makeChange()]);

      const { rows } = await db.pool.query('SELECT count(*) FROM changes');
      expect(rows[0].count).toBe('3');
    });

    it('Should store a missing old length as NULL', async () => {
      await repo.insertMany([
        makeChange({ type: 'new', length_old: undefined, length_new: 500 }),
      ]);

      const { rows } = await db.pool.query(
        'SELECT length_old, length_new FROM changes',
      );
      expect(rows).toEqual([{ length_old: null, length_new: 500 }]);
    });

    it('Should skip changes already stored or repeated in the chunk', async () => {
      const stored = makeChange();
      const repeated = makeChange();
      await repo.insert(stored);

      await repo.insertMany([stored, repeated, repeated]);

      const { rows } = await db.pool.query('SELECT event_id FROM changes');
      expect(rows.map((row) => row.event_id).sort()).toEqual(
        [stored.eventId, repeated.eventId].sort(),
      );
    });
  });

  describe('getReportByBucket', () => {
    it('Should count edits per hour and fill empty hours with zeros', async () => {
      const hour = hourStartAgo(2);
      await repo.insert(makeChange({ eventTime: minutesAfter(hour, 10) }));
      await repo.insert(
        makeChange({ eventTime: minutesAfter(hour, 50), bot: true }),
      );

      const rows = await repo.getReportByBucket('hour', 24);

      expect(rows).toHaveLength(24);
      expect(rowAt(rows, hour)).toMatchObject({
        edits: '2',
        bot_edits: '1',
        bot_share: '0.500',
        bytes_delta: '200',
      });
      expect(rowAt(rows, hourStartAgo(3))).toMatchObject({
        edits: '0',
        bot_share: null,
      });
    });

    it('Should mark old hours final and the current hour not final', async () => {
      const tenHoursAgo = hourStartAgo(10);
      const hour = hourStartAgo(0);
      const rows = await repo.getReportByBucket('hour', 24);

      expect(rowAt(rows, tenHoursAgo)?.final).toBe(true);
      expect(rowAt(rows, hour)?.final).toBe(false);
    });

    it('Should count only edit and new changes', async () => {
      const hour = hourStartAgo(2);
      await repo.insert(
        makeChange({ eventTime: minutesAfter(hour, 0), type: 'edit' }),
      );
      await repo.insert(
        makeChange({ eventTime: minutesAfter(hour, 0), type: 'new' }),
      );
      await repo.insert(
        makeChange({ eventTime: minutesAfter(hour, 0), type: 'log' }),
      );

      const rows = await repo.getReportByBucket('hour', 24);
      expect(rowAt(rows, hour)).toMatchObject({ edits: '2' });
    });

    it(`Should put a change at 23:30 UTC into its own day`, async () => {
      await repo.insert(
        makeChange({ eventTime: minutesAfter(hourStartAgo(48), 10) }),
      );
      await repo.insert(
        makeChange({ eventTime: minutesAfter(hourStartAgo(2), 10) }),
      );

      const rows = await repo.getReportByBucket('hour', 24);
      const total = rows.reduce((sum, row) => sum + Number(row.edits), 0);
      expect(total).toBe(1);
    });

    it(`Should leave out changes older than the window`, async () => {
      await repo.insert(
        makeChange({ eventTime: minutesAfter(dayStartAgo(1), 23 * 60 + 30) }),
      );

      const rows = await repo.getReportByBucket('day', 7);
      expect(rowAt(rows, dayStartAgo(1))).toMatchObject({ edits: '1' });
      expect(rowAt(rows, dayStartAgo(0))).toMatchObject({ edits: '0' });
    });
  });

  describe('getTopPages', () => {
    it('Should rank articles by edits within the window', async () => {
      const recent = minutesAgo(10);
      await repo.insert(
        makeChange({ title: 'Alpha', author: 'a1', eventTime: recent }),
      );
      await repo.insert(
        makeChange({ title: 'Alpha', author: 'a2', eventTime: recent }),
      );
      await repo.insert(
        makeChange({ title: 'Alpha', author: 'a2', eventTime: recent }),
      );
      await repo.insert(
        makeChange({ title: 'Beta', bot: true, eventTime: recent }),
      );
      await repo.insert(
        makeChange({ title: 'Alpha', eventTime: minutesAgo(120) }),
      );
      for (let i = 0; i < 5; i++) {
        await repo.insert(
          makeChange({ title: 'Talk:Alpha', namespace: 1, eventTime: recent }),
        );
      }

      const pages = await repo.getTopPages(1, 10);

      expect(pages).toEqual([
        {
          wiki: 'enwiki',
          title: 'Alpha',
          edits: '3',
          bot_edits: '0',
          authors: '2',
        },
        {
          wiki: 'enwiki',
          title: 'Beta',
          edits: '1',
          bot_edits: '1',
          authors: '1',
        },
      ]);
    });

    it('Should keep only the requested wiki', async () => {
      const recent = minutesAgo(10);
      await repo.insert(
        makeChange({ wiki: 'enwiki', title: 'Alpha', eventTime: recent }),
      );
      await repo.insert(
        makeChange({ wiki: 'ukwiki', title: 'Альфа', eventTime: recent }),
      );

      const pages = await repo.getTopPages(1, 10, 'ukwiki');

      expect(pages.map((page) => page.title)).toEqual(['Альфа']);
    });

    it('Should return no more pages than the limit', async () => {
      const recent = minutesAgo(10);
      await repo.insert(makeChange({ title: 'Alpha', eventTime: recent }));
      await repo.insert(makeChange({ title: 'Alpha', eventTime: recent }));
      await repo.insert(makeChange({ title: 'Beta', eventTime: recent }));

      const pages = await repo.getTopPages(1, 1);

      expect(pages.map((page) => page.title)).toEqual(['Alpha']);
    });
  });

  describe('getPageEdits', () => {
    const kyiv = { wiki: 'ukwiki', title: 'Київ' };

    beforeEach(async () => {
      await repo.insertMany([
        makeChange({
          ...kyiv,
          author: 'Andrii',
          eventTime: minutesAgo(10),
          length_old: 1000,
          length_new: 1100,
        }),
        makeChange({
          ...kyiv,
          author: 'Bohdan',
          eventTime: minutesAgo(20),
          length_old: 1100,
          length_new: 800,
        }),
        makeChange({
          ...kyiv,
          author: 'Andrii',
          eventTime: minutesAgo(30),
          length_old: 800,
          length_new: 1100,
        }),
        makeChange({
          ...kyiv,
          author: 'InternetArchiveBot',
          bot: true,
          eventTime: minutesAgo(40),
          length_old: 1100,
          length_new: 1150,
        }),
        makeChange({
          ...kyiv,
          type: 'new',
          author: 'Chrystyna',
          eventTime: minutesAgo(23 * 60),
          length_old: undefined,
          length_new: 800,
        }),
        makeChange({ ...kyiv, author: 'Old', eventTime: minutesAgo(30 * 60) }),
        makeChange({ ...kyiv, type: 'categorize', eventTime: minutesAgo(5) }),
        makeChange({ ...kyiv, wiki: 'enwiki', eventTime: minutesAgo(15) }),
        makeChange({ ...kyiv, title: 'Львів', eventTime: minutesAgo(15) }),
      ]);
    });

    it('Should summarize the edits of the page within the window', async () => {
      const { summary } = await repo.getPageEdits('ukwiki', 'Київ', 24, 20);

      expect(summary).toEqual({
        edits: '5',
        authors: '4',
        bot_edits: '1',
        bytes_delta: '950',
      });
    });

    it('Should count only the requested hours', async () => {
      const { summary } = await repo.getPageEdits('ukwiki', 'Київ', 1, 20);

      expect(summary).toEqual({
        edits: '4',
        authors: '3',
        bot_edits: '1',
        bytes_delta: '150',
      });
    });

    it('Should list the latest edits first, no more than the limit', async () => {
      const { edits } = await repo.getPageEdits('ukwiki', 'Київ', 24, 3);

      expect(edits).toEqual([
        {
          event_time: expect.any(Date),
          author: 'Andrii',
          bot: false,
          type: 'edit',
          bytes_delta: 100,
        },
        {
          event_time: expect.any(Date),
          author: 'Bohdan',
          bot: false,
          type: 'edit',
          bytes_delta: -300,
        },
        {
          event_time: expect.any(Date),
          author: 'Andrii',
          bot: false,
          type: 'edit',
          bytes_delta: 300,
        },
      ]);
    });

    it('Should count a new page by its whole size', async () => {
      const { edits } = await repo.getPageEdits('ukwiki', 'Київ', 24, 20);

      expect(edits.at(-1)).toMatchObject({
        type: 'new',
        author: 'Chrystyna',
        bytes_delta: 800,
      });
    });

    it('Should return zeros and no edits for a page nobody edited', async () => {
      const result = await repo.getPageEdits('ukwiki', 'Ужгород', 24, 20);

      expect(result).toEqual({
        summary: { edits: '0', authors: '0', bot_edits: '0', bytes_delta: '0' },
        edits: [],
      });
    });
  });

  describe('getDataStatus', () => {
    it('Should return the newest event time and how long ago it was', async () => {
      const newest = minutesAgo(10.5);
      await repo.insertMany([
        makeChange({ eventTime: minutesAgo(30) }),
        makeChange({ eventTime: newest }),
      ]);

      expect(await repo.getDataStatus()).toEqual({
        data_until: new Date(newest),
        minutes_behind: 10,
      });
    });

    it('Should return nulls when there is no data', async () => {
      expect(await repo.getDataStatus()).toEqual({
        data_until: null,
        minutes_behind: null,
      });
    });
  });
});
