'use client';

import type { LiveEdit } from '@contracts';
import { useLive } from '@/app/live-provider';
import { Card } from './card';
import { cn } from '@/lib/utils';
import { useEffect, useReducer, useState } from 'react';
import { Pause, Play } from 'lucide-react';

type Filters = { wiki?: string; bots?: boolean };
type FeedState = { filters: Filters; edits: LiveEdit[] };
type FeedAction =
  { type: 'edits'; edits: LiveEdit[] } | { type: 'filters'; filters: Filters };

const LIMIT = 100;
const COLS =
  'grid grid-cols-[64px_96px_minmax(0,1.2fr)_120px_64px_minmax(0,1fr)] items-baseline gap-3 px-5';

const WHO = [
  { label: 'All', bots: undefined },
  { label: 'Humans', bots: false },
  { label: 'Bots', bots: true },
] as const;

const matches = (e: LiveEdit, { wiki, bots }: Filters) =>
  (!wiki || e.wiki === wiki) && (bots === undefined || e.bot === bots);

function countNew(live: LiveEdit[], frozen: LiveEdit[]) {
  const i = live.findIndex((e) => e.id === frozen[0]?.id);
  return i === -1 ? live.length : i;
}

function deltaColor(diffCount: number) {
  if (diffCount === 0) return 'text-[#9AA3B2]';
  if (diffCount > 0) return 'text-emerald-400';
  return 'text-rose-400';
}

const hms = new Intl.DateTimeFormat('en-GB', {
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});

// Δ зі знаком: +1,036 · -12 · 0
const signed = new Intl.NumberFormat('en-US', { signDisplay: 'exceptZero' });

// Спільний вигляд бейджів NEW і BOT. shrink-0: довга назва поруч не стискає бейдж
const BADGE =
  'shrink-0 rounded-[6px] px-1.5 py-0.5 text-[10px] font-semibold uppercase';

function feedReducer(state: FeedState, action: FeedAction): FeedState {
  switch (action.type) {
    case 'edits': {
      const seen = new Set(state.edits.map((e) => e.id));
      const fresh: LiveEdit[] = [];
      for (const edit of action.edits) {
        if (seen.has(edit.id) || !matches(edit, state.filters)) continue;
        seen.add(edit.id);
        fresh.unshift(edit);
      }
      if (fresh.length === 0) return state;
      return { ...state, edits: [...fresh, ...state.edits].slice(0, LIMIT) };
    }
    case 'filters':
      return {
        filters: action.filters,
        edits: state.edits.filter((e) => matches(e, action.filters)),
      };
  }
}

type HeaderProps = {
  filters: Filters;
  wikis: string[];
  onFilters: (filters: Filters) => void;
  pinned: boolean;
  newCount: number | null;
  onPause: () => void;
};

function Header({
  filters,
  onFilters,
  wikis,
  newCount,
  onPause,
  pinned,
}: HeaderProps) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 px-5 mb-3">
      <div className="flex flex-col">
        <h3 className="text-[15px]">Live edits</h3>
        <span className="text-xs text-[#9AA3B2]">
          {newCount === null
            ? `Newest first · keeps the last ${LIMIT}`
            : `Paused · ${newCount > 99 ? '99+' : newCount} new`}
        </span>
      </div>
      <div className="flex items-center">
        <label className="mr-2.5">
          <span className="mr-2 text-[#9AA3B2] text-xs">Wiki</span>
          <select
            value={filters.wiki ?? ''}
            onChange={(e) =>
              onFilters({ ...filters, wiki: e.target.value || undefined })
            }
            className="h-10 rounded-[10px] border border-[#262B36] bg-[#151821] px-3 text-[13px] text-[#E7E9EE]"
          >
            <option value="">All wikis</option>
            {wikis.map((wiki) => (
              <option key={wiki} value={wiki}>
                {wiki}
              </option>
            ))}
          </select>
        </label>

        <div
          role="group"
          aria-label="Editors"
          className="inline-flex gap-0.5 rounded-[12px] border border-[#262B36] bg-[#151821] p-0.75 mr-2.5"
        >
          {WHO.map((o) => {
            const active = filters.bots === o.bots;
            return (
              <button
                key={o.label}
                type="button"
                aria-pressed={active}
                onClick={() => onFilters({ ...filters, bots: o.bots })}
                className={cn(
                  'h-8 rounded-[9px] px-3.5 text-[13px] font-medium',
                  active
                    ? 'bg-[#262B36] text-[#E7E9EE]'
                    : 'text-[#9AA3B2] hover:text-[#E7E9EE]',
                )}
              >
                {o.label}
              </button>
            );
          })}
        </div>

        <button
          type="button"
          aria-pressed={pinned}
          onClick={onPause}
          className="inline-flex h-10 items-center gap-2 rounded-[10px] border border-[#262B36] bg-[#151821] px-4 text-[13px] font-medium text-[#E7E9EE]"
        >
          {pinned ? (
            <Play className="size-4" aria-hidden />
          ) : (
            <Pause className="size-4" aria-hidden />
          )}
          {pinned ? 'Resume' : 'Pause feed'}
        </button>
      </div>
    </div>
  );
}

function EditRow({ edit }: { edit: LiveEdit }) {
  return (
    <div
      className={cn(
        COLS,
        'py-2.5 text-[13px] border-b border-[#171A22] motion-safe:animate-row-flash',
      )}
    >
      <span className="font-mono text-xs tabular-nums text-[#9AA3B2]">
        {hms.format(new Date(edit.ts))}
      </span>

      <span className="justify-self-start font-mono text-[11px] px-1.75 py-0.5 rounded-[6px] bg-[#1E2330] text-[#C9D1DD]">
        {edit.wiki}
      </span>

      {/* Бейдж поза посиланням. min-w-0 на flex-елементі — інакше truncate не обріже назву */}
      <div className="flex min-w-0 items-baseline gap-1.5">
        {edit.type === 'new' && (
          <span className={cn(BADGE, 'bg-[#12301F] text-[#6EE7A8]')}>new</span>
        )}
        <a
          href={edit.titleUrl}
          target="_blank"
          rel="noreferrer"
          className="min-w-0 truncate font-medium hover:underline"
        >
          {edit.title}
        </a>
      </div>
      <span className="flex min-w-0 items-baseline gap-1.5">
        <span className="min-w-0 truncate text-[#C9D1DD]">{edit.user}</span>
        {edit.bot && (
          <span className={cn(BADGE, 'bg-[#2A2111] text-[#F5A524]')}>bot</span>
        )}
      </span>

      <a
        href={edit.diffUrl}
        target="_blank"
        rel="noreferrer"
        title="Open the diff"
        className={cn(
          'text-right font-mono text-xs tabular-nums hover:underline',
          deltaColor(edit.delta),
        )}
      >
        {signed.format(edit.delta)}
      </a>

      <span
        className="block truncate text-xs text-[#9AA3B2]"
        title={edit.comment}
      >
        {edit.comment || '—'}
      </span>
    </div>
  );
}

export function LiveEditsCard() {
  const { subscribeEdits, stats } = useLive();
  const [{ edits, filters }, dispatch] = useReducer(feedReducer, {
    filters: {},
    edits: [],
  });

  function setFilters(next: Filters) {
    setPinned(false);
    setFrozen(null);
    dispatch({ type: 'filters', filters: next });
  }
  const wikis = stats.topWikis.map((w) => w.wiki);
  if (filters.wiki && !wikis.includes(filters.wiki)) wikis.push(filters.wiki);

  useEffect(
    () => subscribeEdits((batch) => dispatch({ type: 'edits', edits: batch })),
    [subscribeEdits],
  );

  const [pinned, setPinned] = useState(false); // натиснута кнопка Pause
  const [frozen, setFrozen] = useState<LiveEdit[] | null>(null); // знімок на момент паузи

  const rows = frozen ?? edits; // що показуємо
  const newCount = frozen ? countNew(edits, frozen) : null; // null — не на паузі

  // Якщо вже заморожено наведенням, знімок не перезаписуємо
  const freeze = () => setFrozen((f) => f ?? edits);

  function togglePause() {
    if (pinned) {
      setPinned(false);
      setFrozen(null);
    } else {
      setPinned(true);
      freeze();
    }
  }

  return (
    <Card className="xl:col-span-2 px-0 pb-2">
      <Header
        filters={filters}
        wikis={wikis}
        onFilters={setFilters}
        pinned={pinned}
        newCount={newCount}
        onPause={togglePause}
      />
      <div
        className="max-h-140 overflow-auto"
        onMouseEnter={freeze}
        onMouseLeave={() => {
          if (!pinned) setFrozen(null);
        }}
      >
        <div
          className={cn(
            COLS,
            'sticky top-0 z-10 bg-[#111318] py-2 text-xs text-[#9AA3B2] border-b border-[#1F232C]',
          )}
        >
          <span>Time</span>
          <span>Wiki</span>
          <span>Article</span>
          <span>User</span>
          <span className="text-right">Δ bytes</span>
          <span>Summary</span>
        </div>
        {rows.map((e) => (
          <EditRow key={e.id} edit={e} />
        ))}
      </div>
    </Card>
  );
}
