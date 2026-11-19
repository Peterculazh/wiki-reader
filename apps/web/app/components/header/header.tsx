import { Activity } from 'lucide-react';
import { LiveBadge } from './liveBage';
import { DownloadReport } from './downloadReport';

export default function Header() {
  return (
    <header className="mb-5 flex w-full flex-wrap items-center justify-between gap-4 py-2">
      <div className="flex items-center">
        <div className="flex items-center justify-center w-10 h-10 rounded-lg border border-[#262B36] bg-[#161A22]">
          <Activity className="size-5" />
        </div>
        <div className="flex flex-col items-start justify-center ml-3.5">
          <h1 className="text-lg font-semibold text-[#E7E9EE]">wiki-reader</h1>
          <span className="text-sm text-[#9AA3B2]">
            Wikipedia, as it is being edited
          </span>
        </div>
        <LiveBadge className="ml-3" />
      </div>
      <div>
        <DownloadReport />
      </div>
    </header>
  );
}
