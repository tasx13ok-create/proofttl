const MAX_QUERIES = 4;
const MAX_RESULTS_PER_SOURCE = 6;
const FETCH_RESULTS_PER_SOURCE = 12;
const REQUEST_TIMEOUT_MS = 9000;
const RECENT_DAYS = 180;
const STOP_WORDS = new Set([
  'about','after','again','against','also','among','and','are','because','been','before','being','between','business','current','during','each','from','have','into','just','market','more','most','new','only','other','over','pain','problem','problems','recent','search','should','some','such','than','that','their','them','there','these','they','this','those','through','under','very','what','when','where','which','while','with','work','workflow','year','years'
]);

export async function collectFoundryEvidence(queries) {
  const normalized = normalizeQueries(queries);
  const tasks = normalized.flatMap((query) => [
    { source: 'hacker_news', query, run: () => collectHackerNews(query) },
    { source: 'gdelt_news', query, run: () => collectGdelt(query) },
  ]);
  const settled = await Promise.allSettled(tasks.map((task) => task.run()));
  const evidence = [];
  const failures = [];
  const empty = [];
  let reachableSources = 0;
  let productiveSources = 0;

  settled.forEach((result, index) => {
    const task = tasks[index];
    if (result.status === 'fulfilled') {
      reachableSources += 1;
      const items = Array.isArray(result.value?.items) ? result.value.items : [];
      if (items.length) {
        productiveSources += 1;
        evidence.push(...items);
      } else {
        empty.push(`${task.source}:${task.query}`);
      }
      return;
    }
    failures.push(`${task.source}:${task.query}:${errorName(result.reason)}`);
  });

  const unique = dedupeEvidence(evidence).slice(0, MAX_QUERIES * MAX_RESULTS_PER_SOURCE * 2);
  const querySet = new Set(unique.map((item) => item.query_text).filter(Boolean));
  const sourceTypeSet = new Set(unique.map((item) => item.source_type).filter(Boolean));
  return {
    queries: normalized,
    evidence: unique,
    stats: {
      requested_sources: tasks.length,
      reachable_sources: reachableSources,
      successful_sources: productiveSources,
      productive_sources: productiveSources,
      empty_sources: empty.length,
      failed_sources: failures.length,
      evidence_items: unique.length,
      queries_with_evidence: querySet.size,
      source_types_with_evidence: sourceTypeSet.size,
    },
    failures,
    empty,
  };
}

export function normalizeFoundrySearchQueries(value) {
  return normalizeQueries(value);
}

async function collectHackerNews(query) {
  const profile = queryProfile(query);
  const since = Math.floor((Date.now() - RECENT_DAYS * 86400000) / 1000);
  const params = new URLSearchParams({
    query: profile.sourceQuery,
    numericFilters: `created_at_i>${since}`,
    hitsPerPage: String(FETCH_RESULTS_PER_SOURCE),
  });
  const url = `https://hn.algolia.com/api/v1/search_by_date?${params.toString()}`;
  const body = await fetchJson(url);
  const hits = Array.isArray(body?.hits) ? body.hits : [];
  const items = hits.map((hit) => {
    const objectId = clean(hit?.objectID, 80);
    const rawTitle = hit?.title || hit?.story_title || stripHtml(hit?.comment_text || hit?.story_text);
    const title = clean(rawTitle, 260) || 'Hacker News discussion';
    const excerpt = clean(stripHtml(hit?.comment_text || hit?.story_text || ''), 900) || null;
    const relevance = relevanceScore(`${title} ${excerpt || ''}`, profile.terms);
    return {
      relevance,
      source_type: 'hacker_news',
      query_text: query,
      title,
      url: objectId ? `https://news.ycombinator.com/item?id=${encodeURIComponent(objectId)}` : 'https://news.ycombinator.com/',
      excerpt,
      published_at: clean(hit?.created_at, 80) || null,
      source_domain: 'news.ycombinator.com',
    };
  }).filter((item) => item.relevance > 0)
    .sort((a, b) => b.relevance - a.relevance)
    .slice(0, MAX_RESULTS_PER_SOURCE)
    .map(({ relevance, ...item }) => item);
  return { source: 'hacker_news', query, items };
}

async function collectGdelt(query) {
  const profile = queryProfile(query);
  const gdeltTerms = profile.terms.slice(0, 4).map((term) => safeGdeltTerm(term));
  const gdeltQuery = gdeltTerms.length > 1
    ? `(${gdeltTerms.join(' OR ')}) sourcelang:english`
    : `${gdeltTerms[0] || safeGdeltTerm(profile.sourceQuery)} sourcelang:english`;
  const params = new URLSearchParams({
    query: gdeltQuery,
    mode: 'artlist',
    maxrecords: String(FETCH_RESULTS_PER_SOURCE),
    format: 'json',
    sort: 'datedesc',
    timespan: '6months',
  });
  const url = `https://api.gdeltproject.org/api/v2/doc/doc?${params.toString()}`;
  const body = await fetchJson(url);
  const articles = Array.isArray(body?.articles) ? body.articles : [];
  const items = articles.map((article) => {
    const articleUrl = safeHttpUrl(article?.url);
    const title = clean(article?.title, 260);
    if (!articleUrl || !title) return null;
    const relevance = relevanceScore(title, profile.terms);
    return {
      relevance,
      source_type: 'gdelt_news',
      query_text: query,
      title,
      url: articleUrl,
      excerpt: null,
      published_at: clean(article?.seendate, 80) || null,
      source_domain: domainOf(articleUrl),
    };
  }).filter((item) => item && item.relevance > 0)
    .sort((a, b) => b.relevance - a.relevance)
    .slice(0, MAX_RESULTS_PER_SOURCE)
    .map(({ relevance, ...item }) => item);
  return { source: 'gdelt_news', query, items };
}

async function fetchJson(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: { 'accept': 'application/json', 'user-agent': 'ProofTTL-Foundry/1.0 (+https://proofttl-web.vercel.app)' },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`research_http_${response.status}`);
    const contentLength = Number(response.headers.get('content-length') || 0);
    if (contentLength > 2_000_000) throw new Error('research_response_too_large');
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

function normalizeQueries(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  const output = [];
  for (const raw of value) {
    const query = clean(raw, 120).replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ');
    if (query.length < 3) continue;
    const key = query.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(query);
    if (output.length >= MAX_QUERIES) break;
  }
  return output;
}

function queryProfile(query) {
  const tokens = String(query || '').toLowerCase().match(/[a-z0-9][a-z0-9-]{2,}/g) || [];
  const terms = [];
  for (const token of tokens) {
    const value = token.replace(/^-+|-+$/g, '');
    if (!value || STOP_WORDS.has(value) || terms.includes(value)) continue;
    terms.push(value);
    if (terms.length >= 6) break;
  }
  if (!terms.length) {
    const fallback = clean(query, 80).toLowerCase().split(/\s+/).filter(Boolean).slice(0, 4);
    terms.push(...fallback);
  }
  return { terms, sourceQuery: terms.slice(0, 4).join(' ') || clean(query, 80) };
}

function relevanceScore(text, terms) {
  const haystack = ` ${String(text || '').toLowerCase().replace(/[^a-z0-9-]+/g, ' ')} `;
  let score = 0;
  for (const term of terms || []) {
    if (haystack.includes(` ${term} `)) score += 2;
    else if (term.length >= 5 && haystack.includes(term)) score += 1;
  }
  return score;
}

function safeGdeltTerm(value) {
  return String(value || '').replace(/[^a-zA-Z0-9-]/g, '').slice(0, 40) || 'business';
}

function dedupeEvidence(items) {
  const seen = new Set();
  const output = [];
  for (const item of items) {
    if (!item?.title || !item?.url) continue;
    const key = String(item.url).toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(item);
  }
  return output;
}

function safeHttpUrl(value) {
  try {
    const url = new URL(String(value || ''));
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : null;
  } catch { return null; }
}

function domainOf(value) {
  try { return new URL(value).hostname.toLowerCase().slice(0, 200); }
  catch { return null; }
}

function stripHtml(value) {
  return String(value || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

function clean(value, max) { return typeof value === 'string' ? value.trim().slice(0, max) : ''; }
function errorName(error) { return error?.message || error?.name || 'research_error'; }
