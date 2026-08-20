const COMMONS_API = "https://commons.wikimedia.org/w/api.php";
const MAX_QUERY_CHARS = 120;
const MAX_RESULTS = 4;
const SEARCH_CANDIDATES = 10;

export async function handleAssistantVisuals(request) {
  if (request.method !== "GET") {
    return jsonResponse({ error: "method_not_allowed", message: "Use GET with a q query parameter." }, 405, { allow: "GET, OPTIONS" });
  }

  const url = new URL(request.url);
  const query = normalizeVisualQuery(url.searchParams.get("q"));
  if (!query) return jsonResponse({ error: "visual_query_required", message: "Provide a short visual search query." }, 400);

  try {
    const visuals = await searchCommonsVisuals(query);
    return jsonResponse({
      query,
      provider: "wikimedia-commons",
      visuals,
      count: visuals.length,
      source_policy: "provider_returned_only"
    });
  } catch (error) {
    console.warn(JSON.stringify({ event: "assistant_visual_search_failed", error: safeErrorName(error) }));
    return jsonResponse({ error: "visual_search_unavailable", message: "Relevant image retrieval is temporarily unavailable." }, 503);
  }
}

export async function searchCommonsVisuals(rawQuery) {
  const query = normalizeVisualQuery(rawQuery);
  if (!query) return [];

  const params = new URLSearchParams({
    action: "query",
    format: "json",
    formatversion: "2",
    generator: "search",
    gsrsearch: query,
    gsrnamespace: "6",
    gsrlimit: String(SEARCH_CANDIDATES),
    prop: "imageinfo",
    iiprop: "url|mime|extmetadata",
    iiurlwidth: "720",
    iiextmetadatalanguage: "en",
    iiextmetadatafilter: "ImageDescription|Artist|LicenseShortName|LicenseUrl|Credit"
  });

  const response = await fetch(`${COMMONS_API}?${params.toString()}`, {
    headers: { "user-agent": "ProofTTL-L.O.V.E./1.0 (visual retrieval; contact via ProofTTL)" },
    cf: { cacheTtl: 300, cacheEverything: true }
  });
  if (!response.ok) throw new Error(`commons_http_${response.status}`);

  const body = await response.json().catch(() => null);
  const pages = Array.isArray(body?.query?.pages) ? body.query.pages : [];
  const visuals = [];

  for (const page of pages) {
    if (visuals.length >= MAX_RESULTS) break;
    const info = Array.isArray(page?.imageinfo) ? page.imageinfo[0] : null;
    if (!info || typeof info.mime !== "string" || !info.mime.startsWith("image/")) continue;

    const imageUrl = safeHttpsUrl(info.thumburl || info.url, ["upload.wikimedia.org"]);
    const sourceUrl = safeHttpsUrl(info.descriptionurl, ["commons.wikimedia.org"]);
    if (!imageUrl || !sourceUrl) continue;

    const meta = info.extmetadata || {};
    const title = cleanTitle(page?.title);
    const description = stripMarkup(meta?.ImageDescription?.value || "").slice(0, 220);
    const artist = stripMarkup(meta?.Artist?.value || "").slice(0, 140);
    const license = stripMarkup(meta?.LicenseShortName?.value || "").slice(0, 80);
    const licenseUrl = safeHttpsUrl(meta?.LicenseUrl?.value, ["creativecommons.org", "www.gnu.org", "commons.wikimedia.org"]);

    visuals.push({
      type: "image",
      title: title || "Wikimedia Commons image",
      alt: description || title || query,
      image_url: imageUrl,
      source_url: sourceUrl,
      source_name: "Wikimedia Commons",
      provider: "wikimedia-commons",
      ...(artist ? { artist } : {}),
      ...(license ? { license } : {}),
      ...(licenseUrl ? { license_url: licenseUrl } : {}),
      ...(Number.isFinite(Number(info.thumbwidth)) ? { width: Number(info.thumbwidth) } : {}),
      ...(Number.isFinite(Number(info.thumbheight)) ? { height: Number(info.thumbheight) } : {})
    });
  }

  return visuals;
}

export function visualQueryFromMessage(value) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (!text || text.length > 500) return null;

  const patterns = [
    /^(?:please\s+)?(?:show|give)\s+me\s+(?:(?:an|a|the|some)\s+)?(?:(?:picture|photo|image|visual|diagram)s?\s+)?(?:of\s+)?(.+)$/i,
    /^(?:find|show)\s+(?:(?:an|a|the|some)\s+)?(?:picture|photo|image|visual|diagram)s?\s+(?:of|for)\s+(.+)$/i,
    /^(?:what\s+does|what\s+do)\s+(.+?)\s+look\s+like\??$/i,
    /^(?:picture|photo|image|visual|diagram)s?\s+(?:of|for)\s+(.+)$/i
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (!match?.[1]) continue;
    const query = normalizeVisualQuery(match[1].replace(/[?.!]+$/, ""));
    if (query) return query;
  }

  return null;
}

function normalizeVisualQuery(value) {
  if (typeof value !== "string") return "";
  return value
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^(?:an|a|the)\s+/i, "")
    .slice(0, MAX_QUERY_CHARS);
}

function cleanTitle(value) {
  return typeof value === "string" ? value.replace(/^File:/i, "").trim().slice(0, 160) : "";
}

function stripMarkup(value) {
  return String(value || "")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function safeHttpsUrl(value, allowedHosts) {
  if (typeof value !== "string" || !value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password) return null;
    const host = url.hostname.toLowerCase();
    if (!allowedHosts.some((allowed) => host === allowed || host.endsWith(`.${allowed}`))) return null;
    return url.toString();
  } catch {
    return null;
  }
}

function safeErrorName(error) {
  return error?.name || error?.constructor?.name || "Error";
}

function jsonResponse(body, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...extraHeaders }
  });
}

export const ASSISTANT_VISUALS = Object.freeze({ provider: "wikimedia-commons", maxResults: MAX_RESULTS, maxQueryChars: MAX_QUERY_CHARS });
