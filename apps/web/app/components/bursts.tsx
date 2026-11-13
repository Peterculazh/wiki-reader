'use client';

import { useState } from 'react';
import type { BurstEvent, BurstRevision } from '@contracts';
import { Sheet, SheetClose, SheetContent } from '@/components/ui/sheet';
import { useLive } from '@/app/live-provider';
import { ago, useNow } from '@/app/use-now';
import { cn } from '@/lib/utils';
import { Card } from './card';
import { ExternalLink, XIcon } from 'lucide-react';

const hm = new Intl.DateTimeFormat('en-GB', {
  hour: '2-digit',
  minute: '2-digit',
});
const hms = new Intl.DateTimeFormat('en-GB', {
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});
const FRESH_MS = 2 * 60_000;

// /w/index.php — однаковий шлях на всіх вікі Вікімедіа; без oldRev — це створення сторінки
function diffUrl(burst: BurstEvent, r: BurstRevision) {
  const base = `${burst.serverUrl}/w/index.php`;
  return r.oldRev
    ? `${base}?diff=${r.rev}&oldid=${r.oldRev}`
    : `${base}?oldid=${r.rev}`;
}

function burstWindow(burst: BurstEvent) {
  const ms = Date.parse(burst.windowEnd) - Date.parse(burst.windowStart);
  const minutes = Math.round(ms / 60_000);
  return minutes < 1 ? '< 1 min' : `${minutes} min`;
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
        <SheetContent
          side="right"
          className="w-full sm:max-w-120"
          showCloseButton={false}
        >
          {selected && <BurstDetails burst={selected} />}
        </SheetContent>
      </Sheet>
    </Card>
  );
}

function BurstDetails({ burst }: { burst: BurstEvent }) {
  const revisions = [...burst.revisions].sort((a, b) =>
    b.ts.localeCompare(a.ts),
  );
  const windowText = burstWindow(burst);
  const range = `${hms.format(new Date(burst.windowStart))} → ${hms.format(new Date(burst.windowEnd))}`;

  return (
    <>
      <div className="flex flex-col p-6">
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <div className="text-xs uppercase text-[#9AA3B2] font-medium">
              burst
            </div>{' '}
            <SheetClose
              render={
                <button className="w-11 h-11 border border-[#262B36] bg-[#151821] flex items-center justify-center rounded-xl text-[#C9D1DD]" />
              }
            >
              <XIcon className="size-4" />
              <span className="sr-only">Close</span>
            </SheetClose>
          </div>
          <div className="text-2xl font-semibold tracking-tighter mb-1">
            {burst.title}
          </div>
          <div className="flex items-center gap-2 mb-1.5">
            <span
              className="text-xs px-1.75 py-0.5 bg-[#1E2330]
                     text-[#C9D1DD] rounded-[6px]"
            >
              {burst.wiki}
            </span>

            <a
              href={burst.titleUrl}
              target="_blank"
              rel="noreferrer"
              className="text-xs text-[#9DBBFF] hover:underline flex items-center gap-1"
            >
              Open the article
              <ExternalLink className="size-3.5" aria-hidden="true" />
            </a>
          </div>
          <div className="grid grid-cols-3 gap-2.5 mb-2">
            <Card>
              <div className="flex flex-col ">
                <span className="text-xs text-[#9AA3B2]">Editors</span>
                <span className="text-2xl">{burst.authors}</span>
              </div>
            </Card>
            <Card>
              <div className="flex flex-col ">
                <span className="text-xs text-[#9AA3B2]">Edits</span>
                <span className="text-2xl">{burst.editCount}</span>
              </div>
            </Card>
            <Card>
              <div className="flex flex-col ">
                <span className="text-xs text-[#9AA3B2]"> Window</span>
                <span className="text-2xl">{windowText}</span>
              </div>
            </Card>
          </div>
          <div className="text-xs text-[#9AA3B2] mb-2.5">
            {`${range} · detected at ${hms.format(new Date(burst.detectedAt))}`}
          </div>
        </div>
        <div className="mb-2.5">
          <div className="text-sm mb-2.5">Editors</div>
          <div>
            {burst.users.map((user) => (
              <span
                key={user}
                className="text-xs px-2.5 py-1 bg-[#151821] border border-[#262B36] text-[#C9D1DD] rounded-md mr-1.5 mb-1.5 inline-block"
              >
                {user}
              </span>
            ))}
          </div>
        </div>
        <div>
          <div className="font-semibold">Edits in the window, newest first</div>
          <div className="flex flex-col divide-y divide-[#171A22]">
            {revisions.map((r) => (
              <div
                key={r.rev}
                className="grid grid-cols-[72px_minmax(0,1fr)_auto] items-center gap-3 py-2.5 text-[13px]"
              >
                <span className="font-mono text-xs tabular-nums text-[#9AA3B2]">
                  {hms.format(new Date(r.ts))}
                </span>
                <span className="truncate text-[#C9D1DD]">{r.user}</span>
                <a
                  href={diffUrl(burst, r)}
                  target="_blank"
                  rel="noreferrer"
                  className="text-xs text-[#9DBBFF] hover:underline"
                >
                  {r.oldRev ? 'diff' : 'created'}
                </a>
              </div>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}
