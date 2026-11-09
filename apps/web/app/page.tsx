//   import { Activity } from "lucide-react";
//   <Activity className="size-5" />

// export default function Home() {
//   return (
//     <main className="bg-[#0A0B0F]">
//       <div className="flex flex-1 w-full flex-col items-center justify-between bg-#0A0B0F px-4">
//         <header className="flex items-center  w-full py-2">
//           <div className="flex items-center justify-center w-10 h-10 rounded-lg border border-[#262B36] border-1px bg-[#161A22]">
//             <Activity className="size-5" />
//             {/* <svg
//               xmlns="http://www.w3.org/2000/svg"
//               viewBox="0 0 24 24"
//               fill="none"
//               stroke="#E7E9EE"
//               stroke-width="2"
//               stroke-linecap="round"
//               stroke-linejoin="round"
//               className="w-5 h-5"
//             >
//               <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
//             </svg> */}
//           </div>
//           <div className="flex flex-col items-start justify-center ml-3.5">
//             <h1 className='text-lg font-semibold text-[#E7E9EE]'>wiki-reader</h1>
//             <span className='text-sm text-[#9AA3B2]'>Wikipedia, as it is being edited</span>
//           </div>
//           <div className="ml-3 gap-[8px] flex items-center px-2 py-2 rounded-[999px] bg-[#0F2A1C] border-[1] border-[#1C4A31] ">
//             <div className='w-2 h-2 bg-[#34D399] rounded-[50%]'></div>
//             <div className='text-[#6EE7A8] text-xs font-medium'>Live · 24 edits/s</div>
//           </div>
//         </header>
//       </div>
//     </main>
//   );
// }

import { Suspense } from 'react';
import type { BurstEvent, StatsSnapshot } from '@contracts';
import { LiveProvider } from './live-provider';
import Header from './components/header';
import { Body } from './components/body';

async function api<T>(path: string): Promise<T> {
  const response = await fetch(`${process.env.API_URL}${path}`);
  if (!response.ok) throw new Error(`GET ${path}: ${response.status}`);
  return response.json();
}

async function Dashboard() {
  const [stats, bursts] = await Promise.all([
    api<StatsSnapshot>('/stats'),
    api<BurstEvent[]>('/bursts?limit=50'),
  ]);
  return (
    <LiveProvider initialStats={stats} initialBursts={bursts}>
      <main className="max-w-7xl mx-auto w-full flex flex-1  flex-col  bg-#0A0B0F px-4 py-4">
        <Header />
        <Body />
        {/* KPI, графік, фід... */}
      </main>
    </LiveProvider>
  );
}

export default function Page() {
  return (
    <Suspense fallback={<p>Loading…</p>}>
      <Dashboard />
    </Suspense>
  );
}
