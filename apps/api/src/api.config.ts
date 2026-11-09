export const API_CONFIG = Symbol('API_CONFIG');

export type ApiConfig = {
  /** Origins allowed to open GET /live from a browser (CORS) */
  webOrigins: string[];
  /** Edits on GET /live go out in batches this often */
  batchMs: number;
  /** How often GET /live sends a stats snapshot */
  statsIntervalMs: number;
  /** Minutes of edits the stats cover */
  statsWindowMinutes: number;
  /** Entries in `topWikis` and `topPages` */
  topN: number;
  /** Bursts kept in memory, and the most GET /bursts returns */
  maxBursts: number;
};

/**
 * Only the origin comes from the environment, since it differs per setup. The
 * rest are fixed: tests swap the whole object through the API_CONFIG provider.
 */
export function apiConfigFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): ApiConfig {
  const origins = (env.WEB_ORIGIN ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);

  return {
    // `next dev` and the web port-forward both serve the dashboard here
    webOrigins: origins.length > 0 ? origins : ['http://localhost:3000'],
    // The stream carries about 30 edits a second: one React update per batch
    // instead of one per edit
    batchMs: 500,
    statsIntervalMs: 5_000,
    statsWindowMinutes: 60,
    topN: 10,
    maxBursts: 100,
  };
}
