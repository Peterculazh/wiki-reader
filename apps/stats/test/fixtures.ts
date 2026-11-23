import { randomUUID } from 'node:crypto';
import type { ChangesReportRow } from '../src/domain/changes.repository.js';
import type { ChangeCreate } from '../src/domain/changes.repository.js';

const baseEditEvent = {
  $schema: '/mediawiki/recentchange/1.0.0',
  meta: {
    uri: 'https://en.wikipedia.org/wiki/H%C3%B4pital-G%C3%A9n%C3%A9ral_de_Qu%C3%A9bec',
    request_id: 'd1c897ae-709d-4b19-b594-3793abcfdb36',
    id: '2eff3ca4-683a-461d-b77e-fb1e82748e4d',
    domain: 'en.wikipedia.org',
    stream: 'mediawiki.recentchange',
    dt: '2026-11-19T15:05:55.263Z',
    topic: 'codfw.mediawiki.recentchange',
    partition: 0,
    offset: 2169366602,
  },
  id: 2092005234,
  type: 'edit',
  namespace: 0,
  title: 'Hôpital-Général de Québec',
  title_url:
    'https://en.wikipedia.org/wiki/H%C3%B4pital-G%C3%A9n%C3%A9ral_de_Qu%C3%A9bec',
  comment:
    'Correction of the name of the CIUSSSCN - it is "de la Capitale-Nationale" not "de la Vielle-Capitale" - and it has had this name since 2015.',
  timestamp: 1795100752,
  user: '~2026-47492-53',
  bot: false,
  notify_url:
    'https://en.wikipedia.org/w/index.php?diff=1386622369&oldid=1364526660',
  minor: false,
  length: {
    old: 8211,
    new: 8213,
  },
  revision: {
    old: 1364526660,
    new: 1386622369,
  },
  server_url: 'https://en.wikipedia.org',
  server_name: 'en.wikipedia.org',
  server_script_path: '/w',
  wiki: 'enwiki',
  parsedcomment:
    'Correction of the name of the CIUSSSCN - it is &quot;de la Capitale-Nationale&quot; not &quot;de la Vielle-Capitale&quot; - and it has had this name since 2015.',
};

export function makeEditEvent(overrides: Record<string, unknown> = {}) {
  return { ...baseEditEvent, ...overrides };
}

/** JSON of a valid edit event whose meta.id (stored as event_id) is `id`. */
export function editEventJson(id: string): string {
  return JSON.stringify(makeEditEvent({ meta: { ...baseEditEvent.meta, id } }));
}

export function makeReportRow(
  overrides: Partial<ChangesReportRow> = {},
): ChangesReportRow {
  return {
    period_start: new Date('2026-11-19T12:00:00Z'),
    edits: '3',
    bot_edits: '1',
    bot_share: '0.333',
    bytes_delta: '120',
    final: true,
    ...overrides,
  };
}

export function makeChange(
  overrides: Partial<ChangeCreate> = {},
): ChangeCreate {
  return {
    eventId: randomUUID(),
    eventTime: '2026-11-19T12:30:00.000Z',
    wiki: 'enwiki',
    title: 'Coffee',
    type: 'edit',
    author: 'Someone',
    namespace: 0,
    bot: false,
    length_old: 1000,
    length_new: 1100,
    ...overrides,
  };
}
