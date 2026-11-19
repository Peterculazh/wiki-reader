import { Suspense } from 'react';
import type { BurstEvent, StatsSnapshot } from '@contracts';
import { LiveProvider } from './live-provider';
import Header from './components/header/header';
import { Body } from './components/body';

async function fromLive<T>(path: string): Promise<T> {
  const response = await fetch(`${process.env.LIVE_URL}${path}`);
  if (!response.ok) throw new Error(`GET ${path}: ${response.status}`);
  return response.json();
}

async function Dashboard() {
  const [stats, bursts] = await Promise.all([
    fromLive<StatsSnapshot>('/stats'),
    fromLive<BurstEvent[]>('/bursts?limit=50'),
  ]);
  return (
    <LiveProvider initialStats={stats} initialBursts={bursts}>
      <main className="max-w-7xl mx-auto w-full flex flex-1 flex-col px-4 py-4">
        <Header />
        <Body />
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
