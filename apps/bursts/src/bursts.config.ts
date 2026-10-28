export const BURSTS_CONFIG = Symbol('BURSTS_CONFIG');

export type BurstsConfig = {
  /** Sliding window, in event time */
  windowMs: number;
  /** Distinct human users within the window that make a burst */
  minAuthors: number;
  /** After a burst, the same page can't fire again for this long, in event time */
  cooldownMs: number;
  /** Bursts whose last edit is older than this by the wall clock are not published */
  maxLagMs: number;
  /** How often idle pages are dropped, in wall-clock time */
  evictIntervalMs: number;
};

export function burstsConfigFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): BurstsConfig {
  return {
    windowMs: positiveInt(env, 'BURST_WINDOW_MS', 600_000),
    minAuthors: positiveInt(env, 'BURST_MIN_AUTHORS', 3),
    cooldownMs: positiveInt(env, 'BURST_COOLDOWN_MS', 3_600_000),
    maxLagMs: positiveInt(env, 'BURST_MAX_LAG_MS', 900_000),
    evictIntervalMs: positiveInt(env, 'BURST_EVICT_INTERVAL_MS', 60_000),
  };
}

// Fails at startup on a typo instead of silently running with NaN
function positiveInt(
  env: NodeJS.ProcessEnv,
  name: string,
  fallback: number,
): number {
  const raw = env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`${name} must be a positive integer, got "${raw}"`);
  }
  return value;
}
