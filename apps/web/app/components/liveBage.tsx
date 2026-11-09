'use client';

import { cn } from '@/lib/utils';
import { useLive } from '../live-provider';
type LiveBadgeProps = {
  className?: string;
};

export function LiveBadge({ className }: LiveBadgeProps) {
  const { status, stats } = useLive();
  const minute = stats.perMinute.at(-2);
  const perSecond = minute
    ? Math.round((minute.humans + minute.bots) / 60)
    : null;

  const live = status === 'live';
  return (
    <span
      className={cn(
        'inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-medium',
        live
          ? 'border-emerald-900 bg-emerald-950 text-emerald-300'
          : 'border-amber-900 bg-amber-950 text-amber-300',
        className,
      )}
    >
      <span
        className={cn(
          'size-2 rounded-full',
          live ? 'bg-emerald-400' : 'bg-amber-400',
        )}
      />
      {live && `Live · ${perSecond ?? '…'} edits/s`}
      {status === 'connecting' && 'Connecting…'}
      {status === 'offline' && 'Offline'}
    </span>
  );
}
