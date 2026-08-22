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
        assert(!parsed.searchParams.has('tags'), 'Hacker News research is not constrained by mutually exclusive tags');
        const isInsurance = query.includes('insurance') || query.includes('compliance');
        return Response.json({ hits: [{
          objectID: isInsurance ? '222' : '111',
          title: isInsurance ? 'Insurance compliance teams still copy data manually' : 'Contractor admin teams lose hours to manual paperwork',
          comment_text: '<p>Teams still copy <b>data</b> manually &amp; lose hours.</p>',
          created_at: '2026-08-21T12:00:00.000Z'
        }] });
      }

      if (parsed.hostname === 'api.gdeltproject.org') {
        if (query.includes('insurance') || query.includes('compliance')) return new Response('upstream unavailable', { status: 503 });
        return Response.json({ articles: [{
          title: 'Contractor paperwork costs rise as admin requirements expand',
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
    assert(result.stats.reachable_sources === 3 && result.stats.failed_sources === 1, 'one upstream failure is isolated instead of killing the research stage');
    assert(result.stats.productive_sources === 3 && result.stats.successful_sources === 3, 'only sources that return relevant evidence count as successful');
    assert(result.evidence.some((item) => item.source_type === 'hacker_news'), 'Hacker News discussions become explicit evidence signals');
    assert(result.evidence.some((item) => item.source_type === 'gdelt_news'), 'GDELT current-news metadata becomes explicit evidence signals');
    const hn = result.evidence.find((item) => item.source_type === 'hacker_news');
    assert(hn?.excerpt === 'Teams still copy data manually & lose hours.', 'HTML is stripped before evidence enters model context');
    assert(/^https:\/\/news\.ycombinator\.com\/item\?id=/.test(hn?.url || ''), 'Hacker News evidence links to the actual discussion');
    assert(result.failures.length === 1 && result.failures[0].includes('gdelt_news:insurance compliance'), 'research source failures retain source and query context');
    assert(result.stats.queries_with_evidence === 2, 'research reports how many planned queries produced usable signals');
    assert(result.stats.source_types_with_evidence === 2, 'research reports evidence-source diversity');
  } finally {
    globalThis.fetch = originalFetch;
  }

  console.log(`\nSUCCESS: ${passed} Foundry research checks passed.`);
}

run().catch((error) => {
  console.error('\nFOUNDRY RESEARCH TEST FAILED:', error.stack || error.message);
  process.exitCode = 1;
});
