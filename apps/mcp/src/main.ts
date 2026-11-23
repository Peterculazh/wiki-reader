import { McpServer } from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { z } from 'zod';
import { callStats } from './helper/callStats.ts';

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
      return callStats(`/reports/edits?range=${range}`);
    },
  );

  server.registerTool(
    'get_top_pages',
    {
      title: 'Most edited Wikipedia pages',
      description:
        'Articles (main namespace) with the most edits in the last 1–24 hours, with bot edits and the number of distinct authors. ' +
        'Use it to find what is being edited right now. Without `wiki` it covers all Wikimedia wikis, where Wikidata items usually dominate; ' +
        'pass a wiki such as "enwiki" or "ukwiki" to focus on one Wikipedia.',
      inputSchema: z.object({
        hours: z.number().int().min(1).max(24).default(1),
        limit: z.number().int().min(1).max(50).default(10),
        wiki: z.string().optional(),
      }),
    },
    async ({ hours, limit, wiki }) => {
      const params = new URLSearchParams({
        hours: String(hours),
        limit: String(limit),
      });
      if (wiki) params.set('wiki', wiki);
      return callStats(`/reports/top-pages?${params}`);
    },
  );

  server.registerTool(
    'get_page_edits',
    {
      title: 'Edits of one Wikipedia page',
      description:
        'Edits of page, authors of edits, changes in bytes. Newest edits are first.' +
        'Use it to find who changes page and why and how page has been edited.' +
        'Use wiki and title that get_top_pages provided',
      inputSchema: z.object({
        hours: z.number().int().min(1).max(24).default(1),
        limit: z.number().int().min(1).max(50).default(10),
        wiki: z.string(),
        title: z.string().describe('Exact as returned by get_top_pages'),
      }),
    },
    async ({ hours, limit, wiki, title }) => {
      const params = new URLSearchParams({
        hours: String(hours),
        limit: String(limit),
        wiki: String(wiki),
        title: String(title),
      });
      if (wiki) params.set('wiki', wiki);
      return callStats(`/reports/page-edits?${params}`);
    },
  );

  return server;
});
