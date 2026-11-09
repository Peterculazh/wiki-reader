"use client";

import { useLive } from "@/app/live-provider";

const count = new Intl.NumberFormat("en-US");
const percent = new Intl.NumberFormat("en-US", { style: "percent", maximumFractionDigits: 0 });

const NOT_WIKIPEDIA = ["wikidatawiki", "commonswiki"];

export function BusiestWikipediaCard() {
  const { stats } = useLive();

  const top = stats.topWikis.find((w) => !NOT_WIKIPEDIA.includes(w.wiki));
  const total = stats.perMinute.reduce((sum, m) => sum + m.humans + m.bots, 0);
  const share = top && total > 0 ? top.edits / total : null;

  return (
    <div className="rounded-[12] border border-[#1F232C] bg-[#111318] p-5 flex flex-col ml-4">
      <div className="text-[13px] text-[#9AA3B2] mb-2.5">Busiest Wikipedia</div>
      <div className="text-4xl font-semibold leading-none mb-2.5">{top?.wiki ?? "—"}</div>
      <div className="text-xs text-[#9AA3B2]">
        {top && share !== null
          ? `${percent.format(share)} of the hour's edits · ${count.format(top.edits)}`
          : "No data yet"}
      </div>
    </div>
  );
}
