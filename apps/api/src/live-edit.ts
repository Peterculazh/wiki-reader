import type { RecentChangeEvent } from '@app/kafka';
import type { LiveEdit } from '@app/contracts';
import { preview } from './preview.js';

const LIVE_TYPES: ReadonlySet<string> = new Set(['edit', 'new']);

/**
 * Turns a raw `wiki.changes` value into what the dashboard shows. Null for
 * events out of scope (log entries, categorization, Wikimedia's canary events),
 * silently, and for malformed ones, after calling `warn`. Never throws.
 */
export function toLiveEdit(
  value: string | null,
  warn: (message: string) => void = () => {},
): LiveEdit | null {
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

  // Valid but out of scope: no warning, there are many of these
  if (!LIVE_TYPES.has(event.type) || event.meta.domain === 'canary') {
    return null;
  }

  const ts =
    typeof event.meta.dt === 'string' ? Date.parse(event.meta.dt) : NaN;
  const rev = event.revision?.new;
  if (
    !isNonEmptyString(event.meta.id) ||
    Number.isNaN(ts) ||
    !isNonEmptyString(event.wiki) ||
    !isNonEmptyString(event.server_name) ||
    !isNonEmptyString(event.server_url) ||
    !isNonEmptyString(event.title) ||
    !isNonEmptyString(event.title_url) ||
    !isNonEmptyString(event.user) ||
    typeof event.bot !== 'boolean' ||
    typeof event.namespace !== 'number' ||
    typeof rev !== 'number'
  ) {
    return invalid(
      'edit without meta.id, meta.dt, wiki, urls, title, user, bot, namespace or revision.new',
    );
  }

  const oldRev = event.revision?.old;
  // The script path is /w on every Wikimedia wiki; the fallback only guards
  // against an event without it
  const indexPhp = `${event.server_url}${event.server_script_path ?? '/w'}/index.php`;
  const diffUrl =
    typeof oldRev === 'number'
      ? `${indexPhp}?diff=${rev}&oldid=${oldRev}`
      : `${indexPhp}?oldid=${rev}`;

  return {
    id: event.meta.id,
    wiki: event.wiki,
    serverName: event.server_name,
    title: event.title,
    titleUrl: event.title_url,
    diffUrl,
    user: event.user,
    bot: event.bot,
    type: event.type as LiveEdit['type'],
    namespace: event.namespace,
    minor: event.minor === true,
    delta: (event.length?.new ?? 0) - (event.length?.old ?? 0),
    comment: typeof event.comment === 'string' ? event.comment : '',
    ts: new Date(ts).toISOString(),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}
