'use client';

import {
  createContext,
  use,
  useCallback,
  useEffect,
  useReducer,
  useState,
  type ReactNode,
} from 'react';
import type {
  BurstEvent,
  LiveEdit,
  LiveStreamEvents,
  StatsSnapshot,
} from '@contracts';

type Status = 'connecting' | 'live' | 'reconnecting' | 'offline';

type State = {
  status: Status;
  stats: StatsSnapshot;
  bursts: BurstEvent[];
};

type Action =
  | { type: 'status'; status: Status }
  | { type: 'stats'; stats: StatsSnapshot }
  | { type: 'burst'; burst: BurstEvent };

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'status':
      return { ...state, status: action.status };
    case 'stats':
      return { ...state, stats: action.stats };
    case 'burst': {
      const rest = state.bursts.filter(
        (b) => b.burstId !== action.burst.burstId,
      );
      const bursts = [action.burst, ...rest].sort((a, b) =>
        b.detectedAt.localeCompare(a.detectedAt),
      );
      return { ...state, bursts: bursts.slice(0, 50) };
    }
  }
}

type EditsListener = (edits: LiveEdit[]) => void;

type LiveValue = State & {
  subscribeEdits: (listener: EditsListener) => () => void;
};

const LiveContext = createContext<LiveValue | null>(null);

export function LiveProvider({
  initialStats,
  initialBursts,
  children,
}: {
  initialStats: StatsSnapshot;
  initialBursts: BurstEvent[];
  children: ReactNode;
}) {
  const [state, dispatch] = useReducer(reducer, {
    status: 'connecting',
    stats: initialStats,
    bursts: initialBursts,
  });

  const [listeners] = useState(() => new Set<EditsListener>());

  useEffect(() => {
    const source = new EventSource(`${process.env.NEXT_PUBLIC_LIVE_URL}/live`);

    source.onopen = () => dispatch({ type: 'status', status: 'live' });
    source.onerror = () =>
      dispatch({
        type: 'status',
        status:
          source.readyState === EventSource.CLOSED ? 'offline' : 'reconnecting',
      });

    const on = <K extends keyof LiveStreamEvents>(
      name: K,
      handle: (data: LiveStreamEvents[K]) => void,
    ) =>
      source.addEventListener(name, (event) => handle(JSON.parse(event.data)));

    on('stats', (stats) => dispatch({ type: 'stats', stats }));
    on('burst', (burst) => dispatch({ type: 'burst', burst }));
    on('edits', (edits) => listeners.forEach((listener) => listener(edits)));

    return () => source.close();
  }, [listeners]);

  const subscribeEdits = useCallback(
    (listener: EditsListener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    [listeners],
  );

  const value: LiveValue = { ...state, subscribeEdits };
  return <LiveContext value={value}>{children}</LiveContext>;
}

export function useLive() {
  const live = use(LiveContext);
  if (!live) throw new Error('useLive() needs a <LiveProvider> above it');
  return live;
}
