import { McpServer } from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { z } from 'zod';

const STATS_URL = process.env.STATS_URL ?? 'http://localhost:3005';

serveStdio(() => {
  const server = new McpServer(
    { name: 'wiki-reader', version: '0.1.0' },
    { capabilities: { tools: {} } },
  );

  server.registerTool(
    'get_edit_stats',
    {
      title: 'Wikipedia edit statistics',
      description:
        'Edits across all Wikimedia wikis: per hour for the last 24 hours or per day for the last 7 days, with bot share and bytes added.',
      inputSchema: z.object({ range: z.enum(['24h', '7d']) }),
    },
    async ({ range }) => {
      const response = await fetch(`${STATS_URL}/reports/edits?range=${range}`);
      if (!response.ok) {
        return {
          isError: true,
          content: [
            { type: 'text', text: `stats responded with ${response.status}` },
          ],
        };
      }
      const rows = await response.json();
      return { content: [{ type: 'text', text: JSON.stringify(rows) }] };
    },
  );

  return server;
});
