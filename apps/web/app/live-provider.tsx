"use client";

import { createContext, use, useEffect, useReducer, type ReactNode } from "react";
import type { BurstEvent, LiveEdit, LiveStreamEvents, StatsSnapshot } from "@contracts";

type Status = "connecting" | "live" | "reconnecting" | "offline";
type Filters = { wiki?: string; bots?: boolean };

type State = {
  status: Status;
  filters: Filters;
  paused: boolean;
  stats: StatsSnapshot;
  bursts: BurstEvent[];
  edits: LiveEdit[];
};

type Action =
  | { type: "status"; status: Status }
  | { type: "filters"; filters: Filters }
  | { type: "paused"; paused: boolean }
  | { type: "stats"; stats: StatsSnapshot }
  | { type: "edits"; edits: LiveEdit[] }
  | { type: "burst"; burst: BurstEvent };

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case "status":
      return { ...state, status: action.status };
    case "filters":
      // старі рядки під нові фільтри не підходять
      return { ...state, filters: action.filters, edits: [], status: "connecting" };
    case "paused":
      return { ...state, paused: action.paused };
    case "stats":
      return { ...state, stats: action.stats };
    case "edits": {
      if (state.paused) return state;
      const seen = new Set(state.edits.map((e) => e.id));
      const fresh: LiveEdit[] = [];
      for (const edit of action.edits) {
        if (seen.has(edit.id)) continue; // at least once: та сама правка може прийти двічі
        seen.add(edit.id);
        fresh.unshift(edit); // нові зверху
      }
      return { ...state, edits: [...fresh, ...state.edits].slice(0, 100) };
    }
    case "burst": {
      const rest = state.bursts.filter((b) => b.burstId !== action.burst.burstId);
      const bursts = [action.burst, ...rest].sort((a, b) => b.detectedAt.localeCompare(a.detectedAt));
      return { ...state, bursts: bursts.slice(0, 50) };
    }
  }
}

type LiveValue = State & {
  setFilters: (filters: Filters) => void;
  setPaused: (paused: boolean) => void;
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
    status: "connecting",
    filters: {},
    paused: false,
    stats: initialStats,
    bursts: initialBursts,
    edits: [],
  });
  const { wiki, bots } = state.filters;

  // Єдиний EventSource на сторінці; при зміні фільтра перевідкривається
  useEffect(() => {
    const query = new URLSearchParams();
    if (wiki) query.set("wiki", wiki);
    if (bots !== undefined) query.set("bots", String(bots));
    const source = new EventSource(`${process.env.NEXT_PUBLIC_API_URL}/live?${query}`);

    source.onopen = () => dispatch({ type: "status", status: "live" });
    source.onerror = () =>
      dispatch({
        type: "status",
        status: source.readyState === EventSource.CLOSED ? "offline" : "reconnecting",
      });

    const on = <K extends keyof LiveStreamEvents>(
      name: K,
      handle: (data: LiveStreamEvents[K]) => void,
    ) => source.addEventListener(name, (event) => handle(JSON.parse(event.data)));

    on("stats", (stats) => dispatch({ type: "stats", stats }));
    on("edits", (edits) => dispatch({ type: "edits", edits }));
    on("burst", (burst) => dispatch({ type: "burst", burst }));

    return () => source.close();
  }, [wiki, bots]);

  const value: LiveValue = {
    ...state,
    setFilters: (filters) => dispatch({ type: "filters", filters }),
    setPaused: (paused) => dispatch({ type: "paused", paused }),
  };
  return <LiveContext value={value}>{children}</LiveContext>;
}

export function useLive() {
  const live = use(LiveContext);
  if (!live) throw new Error("useLive() needs a <LiveProvider> above it");
  return live;
}
