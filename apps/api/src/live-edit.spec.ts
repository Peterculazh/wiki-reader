import { toLiveEdit } from './live-edit.js';

const base = {
  meta: {
    id: 'event-1',
    dt: '2026-11-07T12:00:30Z',
    domain: 'en.wikipedia.org',
  },
  type: 'edit',
  namespace: 0,
  title: 'Some page',
  title_url: 'https://en.wikipedia.org/wiki/Some_page',
  comment: 'fix typo',
  user: 'Alice',
  bot: false,
  minor: true,
  length: { old: 100, new: 120 },
  revision: { old: 10, new: 11 },
  server_url: 'https://en.wikipedia.org',
  server_name: 'en.wikipedia.org',
  server_script_path: '/w',
  wiki: 'enwiki',
};

const event = (overrides: Record<string, unknown> = {}) =>
  JSON.stringify({ ...base, ...overrides });

describe('toLiveEdit', () => {
  it('maps an edit to what the dashboard shows', () => {
    expect(toLiveEdit(event())).toEqual({
      id: 'event-1',
      wiki: 'enwiki',
      serverName: 'en.wikipedia.org',
      title: 'Some page',
      titleUrl: 'https://en.wikipedia.org/wiki/Some_page',
      diffUrl: 'https://en.wikipedia.org/w/index.php?diff=11&oldid=10',
      user: 'Alice',
      bot: false,
      type: 'edit',
      namespace: 0,
      minor: true,
      delta: 20,
      comment: 'fix typo',
      ts: '2026-11-07T12:00:30.000Z',
    });
  });

  it('links a new page to its first revision and counts its whole size', () => {
    const edit = toLiveEdit(
      event({ type: 'new', length: { new: 500 }, revision: { new: 11 } }),
    );

    expect(edit).toMatchObject({
      type: 'new',
      delta: 500,
      diffUrl: 'https://en.wikipedia.org/w/index.php?oldid=11',
    });
  });

  it.each([
    ['a log entry', { type: 'log' }],
    ['a categorization', { type: 'categorize' }],
    ['a canary event', { meta: { ...base.meta, domain: 'canary' } }],
  ])('skips %s without a warning', (_, overrides) => {
    const warn = vi.fn();

    expect(toLiveEdit(event(overrides), warn)).toBeNull();
    expect(warn).not.toHaveBeenCalled();
  });

  it.each([
    ['an empty value', null],
    ['malformed JSON', 'not json'],
    ['an event without meta', JSON.stringify({ type: 'edit' })],
    ['an edit without a revision', event({ revision: undefined })],
    ['an edit without a user', event({ user: '' })],
  ])('warns about %s', (_, value) => {
    const warn = vi.fn();

    expect(toLiveEdit(value, warn)).toBeNull();
    expect(warn).toHaveBeenCalledOnce();
  });
});
