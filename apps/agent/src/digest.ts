import { costUsd, investigate, type Usage } from './investigate.ts';
import { getJson } from './helper/callStats.ts';

const WIKIS = (process.env.AGENT_WIKIS ?? 'ukwiki,enwiki').split(',');
const DIGEST_SIZE = Number(process.env.DIGEST_SIZE ?? 3);
const MIN_AUTHORS = Number(process.env.MIN_AUTHORS ?? 3);
const HOURS = 12;
// top-pages returns up to 50 pages: take a wide sample, then decide here
// which of them are worth paying an LLM investigation for
const CANDIDATES_LIMIT = 50;

type TopPage = { wiki: string; title: string; edits: number; authors: number };

async function digest() {
  const status = await getJson('/reports/status');
  if (status.minutesBehind === null || status.minutesBehind > 60) {
    console.error(
      `Data is stale (minutesBehind: ${status.minutesBehind}), skipping the digest`,
    );
    return null;
  }

  const pages: TopPage[] = [];
  let skippedPages = 0;
  for (const wiki of WIKIS) {
    const params = new URLSearchParams({
      wiki,
      hours: String(HOURS),
      limit: String(CANDIDATES_LIMIT),
    });
    const top: { pages: TopPage[] } = await getJson(
      `/reports/top-pages?${params}`,
    );

    // A page edited by one author is single_author before any investigation:
    // the LLM would only confirm it, so it is counted here, not investigated
    const candidates = top.pages.filter((page) => page.authors >= MIN_AUTHORS);
    skippedPages += top.pages.length - candidates.length;

    // top-pages is sorted by edits, so these are the busiest of the rest
    pages.push(...candidates.slice(0, DIGEST_SIZE));
  }

  const usage: Usage = { inputTokens: 0, outputTokens: 0 };
  const items = [];
  for (const page of pages) {
    const base = {
      wiki: page.wiki,
      title: page.title,
      edits: page.edits,
      authors: page.authors,
    };
    try {
      items.push({
        ...base,
        verdict: await investigate(page.wiki, page.title, HOURS, usage),
      });
    } catch (err) {
      items.push({
        ...base,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return {
    generatedAt: new Date().toISOString(),
    hours: HOURS,
    wikis: WIKIS,
    dataUntil: status.dataUntil,
    skippedPages,
    costUsd:
      Math.round(costUsd(usage.inputTokens, usage.outputTokens) * 1e6) / 1e6,
    items,
  };
}

console.log(JSON.stringify(await digest(), null, 2));
