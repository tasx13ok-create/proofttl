import { collectFoundryEvidence, normalizeFoundrySearchQueries } from '../src/foundry-research.js';

let passed = 0;
function assert(condition, message) {
  if (!condition) throw new Error(message);
  passed += 1;
  console.log(`PASS ${passed}: ${message}`);
}

async function run() {
  const queries = normalizeFoundrySearchQueries([' contractor admin pain ', 'CONTRACTOR ADMIN PAIN', 'insurance compliance', 'warehouse labor', 'freight paperwork', 'ignored fifth']);
  assert(queries.length === 4, 'research query planner is capped at four unique queries');
  assert(queries[0] === 'contractor admin pain', 'research queries are trimmed and normalized');
  assert(queries.filter((value) => value.toLowerCase() === 'contractor admin pain').length === 1, 'research queries deduplicate case-insensitively');

  const originalFetch = globalThis.fetch;
  const calls = [];
  try {
    globalThis.fetch = async (url) => {
      const parsed = new URL(String(url));
      calls.push(parsed.toString());
      const query = parsed.searchParams.get('query') || '';

      if (parsed.hostname === 'hn.algolia.com') {
        return Response.json({ hits: [{
          objectID: query === 'insurance compliance' ? '222' : '111',
          title: `Pain signal for ${query}`,
          comment_text: '<p>Teams still copy <b>data</b> manually &amp; lose hours.</p>',
          created_at: '2026-08-21T12:00:00.000Z'
        }] });
      }

      if (parsed.hostname === 'api.gdeltproject.org') {
        if (query === 'insurance compliance') return new Response('upstream unavailable', { status: 503 });
        return Response.json({ articles: [{
          title: `News signal for ${query}`,
          url: 'https://example.com/current-market-signal',
          seendate: '20260821T120000Z'
        }] });
      }

      throw new Error(`unexpected host ${parsed.hostname}`);
    };

    const result = await collectFoundryEvidence(['contractor admin pain', 'insurance compliance']);
    assert(calls.length === 4, 'two fixed public sources are queried for each research query');
    assert(calls.every((value) => value.startsWith('https://hn.algolia.com/') || value.startsWith('https://api.gdeltproject.org/')), 'research collectors only call the fixed allowlisted API hosts');
    assert(result.stats.requested_sources === 4, 'research integrity reports requested source count');
    assert(result.stats.successful_sources === 3 && result.stats.failed_sources === 1, 'one upstream failure is isolated instead of killing the research stage');
    assert(result.evidence.some((item) => item.source_type === 'hacker_news'), 'Hacker News discussions become explicit evidence signals');
    assert(result.evidence.some((item) => item.source_type === 'gdelt_news'), 'GDELT current-news metadata becomes explicit evidence signals');
    const hn = result.evidence.find((item) => item.source_type === 'hacker_news');
    assert(hn?.excerpt === 'Teams still copy data manually & lose hours.', 'HTML is stripped before evidence enters model context');
    assert(/^https:\/\/news\.ycombinator\.com\/item\?id=/.test(hn?.url || ''), 'Hacker News evidence links to the actual discussion');
    assert(result.failures.length === 1, 'research source failures are surfaced for the run ledger');
  } finally {
    globalThis.fetch = originalFetch;
  }

  console.log(`\nSUCCESS: ${passed} Foundry research checks passed.`);
}

run().catch((error) => {
  console.error('\nFOUNDRY RESEARCH TEST FAILED:', error.stack || error.message);
  process.exitCode = 1;
});
