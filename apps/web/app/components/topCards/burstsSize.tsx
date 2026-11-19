'use client';

import { ago, useNow } from '../../use-now';
import { Card } from '../card';
import { useLive } from '@/app/live-provider';

const HOUR = 60 * 60_000;

export function BurstsSizeCard() {
  const { bursts } = useLive();
  const now = useNow();

  const lastHour =
    now === null
      ? null
      : bursts.filter((b) => now - Date.parse(b.detectedAt) < HOUR).length;
  const latest = bursts[0];

  const caption = !latest
    ? 'No bursts yet'
    : now === null
      ? '…'
      : `Latest ${ago(latest.detectedAt, now)}, on ${latest.wiki}`;

  return (
    <Card className="flex flex-col ml-4 w-full">
      <div className="text-[13px] text-[#9AA3B2] mb-2.5">
        Bursts · last hour
      </div>

      <div className="text-4xl font-semibold mb-2.5">
        {lastHour}
      </div>

      <div className="text-[13px] text-[#9AA3B2] mb-2.5">
        {caption}
      </div>
    </Card>
  );
}
