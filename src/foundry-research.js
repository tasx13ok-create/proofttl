const MAX_QUERIES = 4;
const MAX_RESULTS_PER_SOURCE = 4;
const REQUEST_TIMEOUT_MS = 8000;
const RECENT_DAYS = 90;

export async function collectFoundryEvidence(queries) {
  const normalized = normalizeQueries(queries);
  const tasks = normalized.flatMap((query) => [
    collectHackerNews(query),
    collectGdelt(query),
  ]);
  const settled = await Promise.allSettled(tasks);
  const evidence = [];
  const failures = [];

  for (const result of settled) {
    if (result.status === 'fulfilled') evidence.push(...result.value.items);
    else failures.push(errorName(result.reason));
  }

  const unique = dedupeEvidence(evidence).slice(0, MAX_QUERIES * MAX_RESULTS_PER_SOURCE * 2);
  return {
    queries: normalized,
    evidence: unique,
    stats: {
      requested_sources: tasks.length,
      successful_sources: settled.length - failures.length,
      failed_sources: failures.length,
      evidence_items: unique.length,
    },
    failures,
  };
}

export function normalizeFoundrySearchQueries(value) {
  return normalizeQueries(value);
}

async function collectHackerNews(query) {
  const since = Math.floor((Date.now() - RECENT_DAYS * 86400000) / 1000);
  const params = new URLSearchParams({
    query,
    tags: '(story,comment,ask_hn,show_hn)',
    numericFilters: `created_at_i>${since}`,
    hitsPerPage: String(MAX_RESULTS_PER_SOURCE),
  });
  const url = `https://hn.algolia.com/api/v1/search_by_date?${params.toString()}`;
  const body = await fetchJson(url);
  const hits = Array.isArray(body?.hits) ? body.hits : [];
  const items = hits.slice(0, MAX_RESULTS_PER_SOURCE).map((hit) => {
    const objectId = clean(hit?.objectID, 80);
    const title = clean(hit?.title || hit?.story_title || stripHtml(hit?.comment_text || hit?.story_text), 260) || 'Hacker News discussion';
    const excerpt = clean(stripHtml(hit?.comment_text || hit?.story_text || ''), 900) || null;
    return {
      source_type: 'hacker_news',
      query_text: query,
      title,
      url: objectId ? `https://news.ycombinator.com/item?id=${encodeURIComponent(objectId)}` : 'https://news.ycombinator.com/',
      excerpt,
      published_at: clean(hit?.created_at, 80) || null,
      source_domain: 'news.ycombinator.com',
    };
  });
  return { source: 'hacker_news', query, items };
}

async function collectGdelt(query) {
  const params = new URLSearchParams({
    query,
    mode: 'artlist',
    maxrecords: String(MAX_RESULTS_PER_SOURCE),
    format: 'json',
    sort: 'datedesc',
    timespan: '3months',
  });
  const url = `https://api.gdeltproject.org/api/v2/doc/doc?${params.toString()}`;
  const body = await fetchJson(url);
  const articles = Array.isArray(body?.articles) ? body.articles : [];
  const items = articles.slice(0, MAX_RESULTS_PER_SOURCE).map((article) => {
    const articleUrl = safeHttpUrl(article?.url) || 'https://www.gdeltproject.org/';
    return {
      source_type: 'gdelt_news',
      query_text: query,
      title: clean(article?.title, 260) || 'News signal',
      url: articleUrl,
      excerpt: null,
      published_at: clean(article?.seendate, 80) || null,
      source_domain: domainOf(articleUrl),
    };
  });
  return { source: 'gdelt_news', query, items };
}

async function fetchJson(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: { 'accept': 'application/json', 'user-agent': 'ProofTTL-Foundry/1.0' },
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

function dedupeEvidence(items) {
  const seen = new Set();
  const output = [];
  for (const item of items) {
    if (!item?.title || !item?.url) continue;
    const key = `${String(item.url).toLowerCase()}|${String(item.title).toLowerCase()}`;
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
function errorName(error) { return error?.name || error?.message || 'research_error'; }
