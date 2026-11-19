'use client';

import { Card } from '../card';
import { Sparkline } from '../sparkline';
import { useLive } from '@/app/live-provider';

const count = new Intl.NumberFormat('en-US');
const percent = new Intl.NumberFormat('en-US', {
  style: 'percent',
  maximumFractionDigits: 0,
  signDisplay: 'exceptZero', // +8%, −3%, 0%
});

export function EditsPerMinuteCard() {
  const { stats } = useLive();

  const minutes = stats.perMinute.slice(0, -1).map((m) => m.humans + m.bots);
  const first = minutes.findIndex((n) => n > 0);
  const totals = first === -1 ? [] : minutes.slice(first);

  const last = totals.at(-1);
  const average = totals.length
    ? totals.reduce((sum, n) => sum + n, 0) / totals.length
    : 0;
  const change =
    last !== undefined && average > 0 ? (last - average) / average : null;

  return (
    <Card className="flex flex-col">
      <div className="text-[13px] text-[#9AA3B2] mb-2.5">Edits / min</div>
      <div className="flex items-center mb-2.5">
        <div
          style={{ letterSpacing: '-0.02em' }}
          className="text-3xl font-semibold mr-10"
        >
          {last === undefined ? '—' : count.format(last)}
        </div>
        <Sparkline values={totals.slice(-30)} />
      </div>
      <div className="text-xs text-muted-foreground">
        {change === null ? (
          'Collecting the first minutes…'
        ) : (
          <span>
            <span
              className={change >= 0 ? 'text-emerald-400' : 'text-rose-400'}
            >
              {percent.format(change)}
            </span>{' '}
            vs the average of {count.format(Math.round(average))}
          </span>
        )}
      </div>
    </Card>
  );
}
