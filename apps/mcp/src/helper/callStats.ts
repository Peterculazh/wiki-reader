const STATS_URL = process.env.STATS_URL ?? 'http://localhost:3005';

async function getJson(path: string) {
  const response = await fetch(`${STATS_URL}${path}`);
  if (!response.ok) {
    throw new Error(
      `stats responded with ${response.status}: ${await response.text()}`,
    );
  }
  return response.json();
}

export async function callStats(path: string) {
  try {
    const [data, status] = await Promise.all([
      getJson(path),
      getJson('/reports/status'),
    ]);
    const text = JSON.stringify({ ...status, ...data });
    return { content: [{ type: 'text' as const, text }] };
  } catch (err) {
    const text = err instanceof Error ? err.message : String(err);
    return { isError: true, content: [{ type: 'text' as const, text }] };
  }
}
