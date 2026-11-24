import { costUsd, investigate, type Usage } from './investigate.ts';

const [wiki, title] = process.argv.slice(2);
const usage: Usage = { inputTokens: 0, outputTokens: 0 };
try {
  console.log(
    JSON.stringify(await investigate(wiki, title, 24, usage), null, 2),
  );
} finally {
  const cost = costUsd(usage.inputTokens, usage.outputTokens);
  console.error(
    `total: in ${usage.inputTokens} / out ${usage.outputTokens}, ~$${cost.toFixed(4)}`,
  );
}
