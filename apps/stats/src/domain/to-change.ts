import { ChangeCreate } from './changes.repository.js';
import type { RecentChangeEvent } from '@app/kafka';
import { isNonEmptyString, isRecord, preview } from '@app/utils';

export function toChangeCreate(
  value: string | null,
  warn: (message: string) => void = () => {},
): ChangeCreate | null {
  const invalid = (reason: string) => {
    warn(`Skipping message (${reason}): ${preview(value)}`);
    return null;
  };

  if (value === null) return invalid('empty value');

  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return invalid('malformed JSON');
  }
  if (!isRecord(parsed) || !isRecord(parsed.meta)) return invalid('no meta');
  const event = parsed as Partial<RecentChangeEvent> &
    Pick<RecentChangeEvent, 'meta'>;
  if (typeof event.type !== 'string') return invalid('no type');

  const ts =
    typeof event.meta.dt === 'string' ? Date.parse(event.meta.dt) : NaN;
  if (
    !isNonEmptyString(event.meta.id) ||
    Number.isNaN(ts) ||
    !isNonEmptyString(event.wiki) ||
    !isNonEmptyString(event.server_name) ||
    !isNonEmptyString(event.title) ||
    !isNonEmptyString(event.user) ||
    typeof event.bot !== 'boolean' ||
    typeof event.namespace !== 'number'
  ) {
    return invalid(
      'edit without meta.id, meta.dt, wiki, urls, title, user, bot, namespace or revision.new',
    );
  }

  return {
    wiki: event.wiki,
    author: event.user,
    bot: event.bot,
    eventId: event.meta.id,
    eventTime: event.meta.dt,
    length_new: event.length?.new,
    length_old: event.length?.old,
    title: event.title,
    type: event.type,
    namespace: event.namespace,
  };
}
