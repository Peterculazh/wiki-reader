import {
  ChangesReportRow,
  ChangesRepository,
} from '../src/domain/changes.repository.js';
import { makeChange } from './fixtures.js';
import { startTestDatabase } from './postgres.js';

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
});
