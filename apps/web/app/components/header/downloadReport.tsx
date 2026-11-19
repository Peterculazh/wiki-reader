'use client';

import { useState } from 'react';
import { Download } from 'lucide-react';

const BUCKET = { '24h': 'hour', '7d': 'day' } as const;
type Range = keyof typeof BUCKET;

export function DownloadReport() {
  const [range, setRange] = useState<Range>('24h');
  const href = `${process.env.NEXT_PUBLIC_STATS_URL}/reports/edits.csv?range=${range}`;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <label className="flex items-center gap-2 text-[13px] text-[#9AA3B2]">
        Report
        <select
          value={range}
          onChange={(e) => setRange(e.target.value as Range)}
          className="h-10 rounded-[10px] border border-[#262B36] bg-[#151821] px-3 text-[13px] text-[#E7E9EE]"
        >
          <option value="24h">Last 24 hours · hourly</option>
          <option value="7d">Last 7 days · daily</option>
        </select>
      </label>

      <a
        href={href}
        className="inline-flex h-10 items-center gap-2 rounded-[10px] border border-[#262B36] bg-[#151821] px-4 text-[13px] font-medium text-[#E7E9EE] hover:bg-[#1E2330]"
      >
        <Download className="size-4" aria-hidden />
        Download CSV
      </a>
    </div>
  );
}
