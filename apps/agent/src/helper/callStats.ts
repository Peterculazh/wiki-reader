const STATS_URL = process.env.STATS_URL ?? 'http://localhost:3005';

export async function getJson(path: string) {
  const response = await fetch(`${STATS_URL}${path}`);
  if (!response.ok) {
    throw new Error(
      `stats responded with ${response.status}: ${await response.text()}`,
    );
  }
  return response.json();
}

export async function callStats(path: string) {
  const [data, status] = await Promise.all([
    getJson(path),
    getJson('/reports/status'),
  ]);
  return JSON.stringify({ ...status, ...data });
}
