'use client';

import { useState } from 'react';
import type { BurstEvent, BurstRevision } from '@contracts';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { useLive } from '@/app/live-provider';
import { ago, useNow } from '@/app/use-now';
import { cn } from '@/lib/utils';
import { Card } from './card';

const hm = new Intl.DateTimeFormat('en-GB', {
  hour: '2-digit',
  minute: '2-digit',
});
const FRESH_MS = 2 * 60_000;

// /w/index.php — однаковий шлях на всіх вікі Вікімедіа; без oldRev — це створення сторінки
function diffUrl(burst: BurstEvent, r: BurstRevision) {
  const base = `${burst.serverUrl}/w/index.php`;
  return r.oldRev
    ? `${base}?diff=${r.rev}&oldid=${r.oldRev}`
    : `${base}?oldid=${r.rev}`;
}

export function BurstsCard() {
  const { bursts } = useLive();
  const actualBursts = bursts.slice(0, 4);
  const now = useNow();
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<BurstEvent | null>(null);

  return (
    <Card className="flex flex-col">
      <div className="flex flex-col mb-2.5">
        <div className="flex justify-between w-full mb-0.5">
          <h3 className="text-[15px]">Bursts</h3>
        </div>
        <div className="text-xs text-[#9AA3B2]">
          Articles edited by 3+ people within 10 minutes
        </div>
      </div>

      {actualBursts.length === 0 ? (
        <p className="text-xs text-[#9AA3B2]">
          No bursts yet. One appears when 3+ people edit the same article within
          10 minutes.
        </p>
      ) : (
        <ul className="flex flex-col gap-2.5">
          {actualBursts.map((burst) => {
            const fresh =
              now !== null && now - Date.parse(burst.detectedAt) < FRESH_MS;
            return (
              <li key={burst.burstId}>
                <button
                  type="button"
                  onClick={() => {
                    setSelected(burst);
                    setOpen(true);
                  }}
                  className={cn(
                    'w-full rounded-[10px] border bg-[#151821] px-3.5 py-3 text-left',
                    fresh ? 'border-[#3A4A6B]' : 'border-[#1F232C]',
                  )}
                >
                  <div className="flex items-center mb-1 justify-between">
                    <span className="text-sm font-semibold text-[#E7E9EE]">
                      {burst.title}
                    </span>
                    <span className="ml-2 text-xs text-[#9AA3B2]">
                      {now === null ? '…' : ago(burst.detectedAt, now)}
                    </span>
                  </div>
                  <div className="flex">
                    <span
                      className="text-xs px-1.75 py-0.5 bg-[#1E2330]
                     text-[#C9D1DD] rounded-[6px]"
                    >
                      {burst.wiki}
                    </span>
                    <span className="mx-1 text-xs text-[#9AA3B2]">·</span>
                    <span className="text-xs text-[#9AA3B2]">
                      {burst.authors} editors
                    </span>
                    <span className="mx-1 text-xs text-[#9AA3B2]">·</span>
                    <span className="text-xs text-[#9AA3B2]">
                      {burst.editCount} edits
                    </span>
                    <div className="flex ml-2">
                      <span className="text-xs text-[#9AA3B2]">
                        {hm.format(new Date(burst.windowStart))}
                      </span>
                      <span className="mx-1 text-xs text-[#9AA3B2]">–</span>
                      <span className="text-xs text-[#9AA3B2]">
                        {hm.format(new Date(burst.windowEnd))}
                      </span>
                    </div>
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="right" className="w-full sm:max-w-[480px]">
          {selected && (
            <>
              <SheetHeader>
                <SheetTitle>{selected.title}</SheetTitle>
                <SheetDescription>
                  {selected.wiki} · {selected.authors} editors ·{' '}
                  {selected.editCount} edits
                </SheetDescription>
              </SheetHeader>
              {/* selected.users чипами; правки — новіші зверху: */}
              {[...selected.revisions]
                .sort((a, b) => b.ts.localeCompare(a.ts))
                .map((r) => (
                  <a
                    key={r.rev}
                    href={diffUrl(selected, r)}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {hm.format(new Date(r.ts))} · {r.user}
                  </a>
                ))}
            </>
          )}
        </SheetContent>
      </Sheet>
    </Card>
  );
}
