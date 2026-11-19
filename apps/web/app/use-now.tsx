// app/use-now.ts
import { useSyncExternalStore } from "react";

const STEP = 15_000;

function subscribe(onChange: () => void) {
  const id = setInterval(onChange, STEP);
  return () => clearInterval(id);
}

// Округлено до кроку: між тиками React отримує те саме число.
// Сирий Date.now() змінювався б щомілісекунди, і React ловив би нескінченні перерендери
const getSnapshot = () => Math.floor(Date.now() / STEP) * STEP;

// На сервері й під час гідрації часу «нема», тож розбіжності між сервером і браузером не буде
const getServerSnapshot = () => null;

export function useNow(): number | null {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

export function ago(iso: string, now: number) {
  const minutes = Math.floor((now - Date.parse(iso)) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  return `${Math.floor(minutes / 60)} h ago`;
}
