'use client';

import { Card } from '../card';
import { useLive } from '@/app/live-provider';

const bigPct = 'text-[32px] font-semibold';
const smallPct = 'text-[20px] font-semibold';

export function HumansVSBotsCard() {
  const { stats } = useLive();

  const humans = stats.perMinute.reduce((sum, m) => sum + m.humans, 0);
  const bots = stats.perMinute.reduce((sum, m) => sum + m.bots, 0);
  const total = humans + bots;
  const humansPct = total ? Math.round((humans / total) * 100) : 0;
  const botsPct = total ? 100 - humansPct : 0;

  return (
    <Card className="flex flex-col ml-4 w-full">
      <div className="text-[13px] text-[#9AA3B2] mb-2.5">Humans vs bots</div>
      <div className="flex items-baseline gap-1">
        <span
          className={`text-[#5B8DEF] ${humansPct >= botsPct ? bigPct : smallPct}`}
        >
          {humansPct}%
        </span>
        <span className="text-[#9AA3B2] text-base">/</span>
        <span
          className={`text-[#F5A524] ${botsPct >= humansPct ? bigPct : smallPct}`}
        >
          {botsPct}%
        </span>
      </div>
      <div className="flex w-full mb-2">
        <div
          className="bg-[#5B8DEF] transition-[width] h-[8] rounded-l-md duration-500"
          style={{ width: `${humansPct}%` }}
        />
        <div
          className="bg-[#F5A524] transition-[width] h-[8] rounded-r-md duration-500"
          style={{ width: `${botsPct}%` }}
        />
      </div>

      <div className="text-[13px] text-[#9AA3B2] mb-2.5">
        Share of edits in the last hour
      </div>
    </Card>
  );
}
