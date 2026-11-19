'use client';

import {
  Area,
  AreaChart,
  CartesianGrid,
  ReferenceLine,
  XAxis,
  YAxis,
} from 'recharts';
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from '@/components/ui/chart';
import { useLive } from '@/app/live-provider';
import { Card } from './card';

const chartConfig = {
  humans: { label: 'Humans', color: '#5B8DEF' },
  bots: { label: 'Bots', color: '#F5A524' },
} satisfies ChartConfig;

const time = new Intl.DateTimeFormat('en-GB', {
  hour: '2-digit',
  minute: '2-digit',
});

export function EditsPerMinuteChart() {
  const { stats, bursts } = useLive();

  // Без поточної хвилини: вона ще набирається і давала б провал у кінці графіка
  const data = stats.perMinute.slice(0, -1).map((m) => ({
    minute: time.format(new Date(m.minute)),
    humans: m.humans,
    bots: m.bots,
  }));

  // Бурсти з цієї ж години — пунктири на тій самій осі X
  const burstMinutes = [
    ...new Set(bursts.map((b) => time.format(new Date(b.detectedAt)))),
  ].filter((m) => data.some((d) => d.minute === m));

  return (
    <Card className="xl:col-span-2">
      <div className="flex flex-col mb-2.5">
        <div className="flex justify-between w-full mb-0.5">
          <h3 className='text-[15px]'>Edits per minute</h3>
          <div className="flex gap-4 text-[#C9D1DD] text-[12px]">
            <div className="flex items-center gap-1">
              <div className="bg-[#5B8DEF] w-2.5 h-2.5 rounded-[3px]"></div>
              <span>Humans</span>
            </div>
            <div className="flex items-center gap-1">
              <div className="bg-[#F5A524] w-2.5 h-2.5 rounded-[3px]"></div>
              <span>Bots</span>
            </div>
            <div className="flex items-center gap-1">
              <div className="bg-[#C9D1DD] w-px h-3"></div>
              <span>Bursts</span>
            </div>
          </div>
        </div>
        <div className='text-xs text-[#9AA3B2]'>Last 60 minutes, humans and bots stacked</div>
      </div>
      <ChartContainer config={chartConfig} className="h-55 w-full">
        <AreaChart data={data} margin={{ left: 0, right: 8 }}>
          <CartesianGrid vertical={false} />
          <XAxis
            dataKey="minute"
            tickLine={false}
            axisLine={false}
            minTickGap={32}
          />
          <YAxis tickLine={false} axisLine={false} width={40} />
          <ChartTooltip content={<ChartTooltipContent indicator="line" />} />
          <Area
            dataKey="humans"
            stackId="edits"
            type="linear"
            fill="var(--color-humans)"
            stroke="var(--color-humans)"
            fillOpacity={0.4}
            isAnimationActive={false}
          />
          <Area
            dataKey="bots"
            stackId="edits"
            type="linear"
            fill="var(--color-bots)"
            stroke="var(--color-bots)"
            fillOpacity={0.3}
            isAnimationActive={false}
          />
          {burstMinutes.map((m) => (
            <ReferenceLine
              key={m}
              x={m}
              stroke="#9AA3B2"
              strokeDasharray="4 4"
            />
          ))}
        </AreaChart>
      </ChartContainer>
    </Card>
  );
}
