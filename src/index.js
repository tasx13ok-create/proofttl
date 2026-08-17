const MODEL = "@cf/meta/llama-3.1-8b-instruct-fast";
const DEFAULT_TTL = 3600;
const MAX_TTL = 604800;
const MAX_SOURCE_CHARS = 30000;
const MAX_HISTORY = 20;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") return cors(new Response(null, { status: 204 }));

    if (request.method === "GET" && url.pathname === "/") {
      return json({
        name: "ProofTTL",
        version: "0.2.0",
        protocol: "ProofTTL/0.2",
        description: "Expiring, source-backed fact leases for machines.",
        endpoints: {
          health: "GET /health",
          verify: "POST /verify",
          lease: "GET /lease/:id",
          reverify: "POST /lease/:id/reverify"
        }
      });
    }

    if (request.method === "GET" && url.pathname === "/health") {
      return json({
        ok: true,
        service: "proofttl",
        version: "0.2.0",
        time: new Date().toISOString(),
        storage: Boolean(env.LEASES),
        ai: Boolean(env.AI)
      });
    }

    if (request.method === "POST" && url.pathname === "/verify") {
      return handleVerify(request, env);
    }

    const reverifyMatch = url.pathname.match(/^\/lease\/([^/]+)\/reverify$/);
    if (request.method === "POST" && reverifyMatch) {
      return handleReverify(decodeURIComponent(reverifyMatch[1]), env);
    }

    const leaseMatch = url.pathname.match(/^\/lease\/([^/]+)$/);
    if (request.method === "GET" && leaseMatch) {
      return handleLeaseGet(decodeURIComponent(leaseMatch[1]), env);
    }

    return json({ error: "not_found" }, 404);
  }
};

async function handleVerify(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "invalid_json" }, 400);
  }

  const claim = typeof body.claim === "string" ? body.claim.trim() : "";
  const sourceUrl = typeof body.source_url === "string" ? body.source_url.trim() : "";
  const ttlSeconds = clampInt(
    body.ttl_seconds ?? DEFAULT_TTL,
    60,
    Number(env.PROOFTTL_MAX_TTL_SECONDS || MAX_TTL)
  );

  if (!claim || claim.length > 1000) return json({ error: "claim_required_or_too_long" }, 400);
  if (!sourceUrl) return json({ error: "source_url_required" }, 400);

  let parsed;
  try {
    parsed = new URL(sourceUrl);
  } catch {
    return json({ error: "invalid_source_url" }, 400);
  }

  if (!isSafePublicHttpUrl(parsed)) return json({ error: "source_url_not_allowed" }, 400);

  const fetched = await fetchSource(
    parsed.toString(),
    Number(env.PROOFTTL_MAX_SOURCE_CHARS || MAX_SOURCE_CHARS)
  );

  if (!fetched.ok) {
    return json({
      status: "UNKNOWN",
      claim,
      source_url: parsed.toString(),
      reason: fetched.reason,
      observed_at: new Date().toISOString()
    });
  }

  const observedAt = new Date();
  const fingerprint = `sha256:${await sha256(fetched.normalizedText)}`;
  const verdict = await verifyClaim({
    claim,
    sourceUrl: parsed.toString(),
    sourceText: fetched.normalizedText,
    env
  });

  const leaseId = `ftl_${crypto.randomUUID().replaceAll("-", "")}`;
  const expiresAt = new Date(observedAt.getTime() + ttlSeconds * 1000);

  const firstCheck = makeCheck({
    kind: "ISSUED",
    observedAt: observedAt.toISOString(),
    fingerprint,
    finalUrl: fetched.finalUrl,
    verdict
  });

  const lease = {
    lease_id: leaseId,
    protocol: "ProofTTL/0.2",
    claim,
    status: verdict.status,
    source_url: parsed.toString(),
    final_url: fetched.finalUrl,
    evidence: verdict.evidence,
    reason: verdict.reason,
    issued_at: observedAt.toISOString(),
    observed_at: observedAt.toISOString(),
    expires_at: expiresAt.toISOString(),
    ttl_seconds: ttlSeconds,
    source_fingerprint: fingerprint,
    confidence: verdict.confidence,
    verifier: verdict.verifier,
    lease_state: "ACTIVE",
    verification_count: 1,
    last_checked_at: observedAt.toISOString(),
    last_check: firstCheck,
    history: [firstCheck]
  };

  await saveLease(env, lease);
  return json(lease);
}

async function handleLeaseGet(id, env) {
  if (!id) return json({ error: "lease_id_required" }, 400);
  if (!env.LEASES) return json({ error: "persistent_storage_not_configured" }, 503);

  const lease = await loadLease(env, id);
  if (!lease) return json({ error: "lease_not_found" }, 404);

  applyExpiryState(lease);
  return json(lease);
}

async function handleReverify(id, env) {
  if (!id) return json({ error: "lease_id_required" }, 400);
  if (!env.LEASES) return json({ error: "persistent_storage_not_configured" }, 503);

  const lease = await loadLease(env, id);
  if (!lease) return json({ error: "lease_not_found" }, 404);

  applyExpiryState(lease);
  const checkedAt = new Date();

  const fetched = await fetchSource(
    lease.source_url,
    Number(env.PROOFTTL_MAX_SOURCE_CHARS || MAX_SOURCE_CHARS)
  );

  if (!fetched.ok) {
    const check = {
      kind: "REVERIFY",
      checked_at: checkedAt.toISOString(),
      result: "SOURCE_UNAVAILABLE",
      status: "UNKNOWN",
      reason: fetched.reason
    };
    recordCheck(lease, check);
    await saveLease(env, lease);
    return json({ lease, check });
  }

  const currentFingerprint = `sha256:${await sha256(fetched.normalizedText)}`;

  if (currentFingerprint === lease.source_fingerprint) {
    const check = {
      kind: "REVERIFY",
      checked_at: checkedAt.toISOString(),
      result: "UNCHANGED_SOURCE",
      status: lease.status,
      source_fingerprint: currentFingerprint,
      final_url: fetched.finalUrl
    };
    recordCheck(lease, check);
    await saveLease(env, lease);
    return json({ lease, check });
  }

  const currentVerdict = await verifyClaim({
    claim: lease.claim,
    sourceUrl: lease.source_url,
    sourceText: fetched.normalizedText,
    env
  });

  const changedStatus = currentVerdict.status !== lease.status;
  const wasUnexpired = checkedAt.getTime() < Date.parse(lease.expires_at);

  let result = "SOURCE_CHANGED_STILL_CONSISTENT";
  if (changedStatus && wasUnexpired) {
    lease.lease_state = "REVOKED";
    lease.revoked_at = checkedAt.toISOString();
    lease.revocation_reason = "source_changed_and_original_verdict_can_no_longer_be_maintained";
    lease.revocation = {
      previous_status: lease.status,
      current_status: currentVerdict.status,
      current_evidence: currentVerdict.evidence,
      current_reason: currentVerdict.reason,
      current_confidence: currentVerdict.confidence,
      current_source_fingerprint: currentFingerprint
    };
    result = "REVOKED";
  } else if (changedStatus) {
    result = "EXPIRED_AND_VERDICT_CHANGED";
  }

  const check = {
    kind: "REVERIFY",
    checked_at: checkedAt.toISOString(),
    result,
    status: currentVerdict.status,
    evidence: currentVerdict.evidence,
    reason: currentVerdict.reason,
    confidence: currentVerdict.confidence,
    verifier: currentVerdict.verifier,
    source_fingerprint: currentFingerprint,
    final_url: fetched.finalUrl
  };

  recordCheck(lease, check);
  await saveLease(env, lease);
  return json({ lease, check });
}

function makeCheck({ kind, observedAt, fingerprint, finalUrl, verdict }) {
  return {
    kind,
    checked_at: observedAt,
    result: "VERIFIED",
    status: verdict.status,
    evidence: verdict.evidence,
    reason: verdict.reason,
    confidence: verdict.confidence,
    verifier: verdict.verifier,
    source_fingerprint: fingerprint,
    final_url: finalUrl
  };
}

function recordCheck(lease, check) {
  lease.verification_count = Number(lease.verification_count || 0) + 1;
  lease.last_checked_at = check.checked_at;
  lease.last_check = check;
  const history = Array.isArray(lease.history) ? lease.history : [];
  history.push(check);
  lease.history = history.slice(-MAX_HISTORY);
  applyExpiryState(lease);
}

function applyExpiryState(lease) {
  if (lease.lease_state !== "REVOKED" && Date.parse(lease.expires_at) <= Date.now()) {
    lease.lease_state = "EXPIRED";
  }
  return lease;
}

async function loadLease(env, id) {
  const raw = await env.LEASES.get(`lease:${id}`);
  return raw ? JSON.parse(raw) : null;
}

async function saveLease(env, lease) {
  if (!env.LEASES) return;
  const retentionSeconds = Math.max(
    Math.ceil((Date.parse(lease.expires_at) - Date.now()) / 1000) + 86400,
    86400
  );
  await env.LEASES.put(`lease:${lease.lease_id}`, JSON.stringify(lease), {
    expirationTtl: retentionSeconds
  });
}

async function fetchSource(sourceUrl, maxChars) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);

  try {
    const response = await fetch(sourceUrl, {
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "User-Agent": "ProofTTL/0.2 (+source-backed fact verification)",
        "Accept": "text/html,text/plain,application/json;q=0.9,*/*;q=0.1"
      }
    });

    if (!response.ok) return { ok: false, reason: `source_http_${response.status}` };

    const contentType = response.headers.get("content-type") || "";
    if (!/(text\/|application\/json|application\/ld\+json|application\/xml|application\/xhtml\+xml)/i.test(contentType)) {
      return { ok: false, reason: "unsupported_source_content_type" };
    }

    const raw = (await response.text()).slice(0, maxChars * 3);
    const normalizedText = normalizeSource(raw, contentType).slice(0, maxChars);
    if (normalizedText.length < 20) return { ok: false, reason: "source_contains_too_little_text" };

    return { ok: true, finalUrl: response.url, normalizedText };
  } catch (error) {
    return {
      ok: false,
      reason: error?.name === "AbortError" ? "source_timeout" : "source_fetch_failed"
    };
  } finally {
    clearTimeout(timeout);
  }
}

function normalizeSource(raw, contentType) {
  if (/json/i.test(contentType)) {
    try {
      return JSON.stringify(JSON.parse(raw));
    } catch {
      return raw.replace(/\s+/g, " ").trim();
    }
  }

  return raw
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}

async function verifyClaim({ claim, sourceUrl, sourceText, env }) {
  const deterministic = deterministicCheck(claim, sourceText);
  if (deterministic) return deterministic;

  if (!env.AI) {
    return {
      status: "UNKNOWN",
      evidence: null,
      reason: "semantic_verifier_not_configured",
      confidence: 0,
      verifier: "none"
    };
  }

  const schema = {
    type: "object",
    properties: {
      status: { type: "string", enum: ["SUPPORTED", "CONTRADICTED", "UNKNOWN"] },
      evidence: { type: ["string", "null"] },
      reason: { type: "string" },
      confidence: { type: "number", minimum: 0, maximum: 1 }
    },
    required: ["status", "evidence", "reason", "confidence"],
    additionalProperties: false
  };

  try {
    const result = await env.AI.run(MODEL, {
      messages: [
        {
          role: "system",
          content: "You are ProofTTL's conservative source verifier. Decide ONLY whether the supplied SOURCE TEXT supports the exact CLAIM. Never use outside knowledge. SUPPORTED means the source text clearly entails the claim. CONTRADICTED means the source text clearly states an incompatible fact. UNKNOWN means ambiguous, missing, stale-looking, conditional, or insufficient. Evidence must be a short exact substring copied from SOURCE TEXT, or null. Prefer UNKNOWN over guessing."
        },
        {
          role: "user",
          content: `CLAIM:\n${claim}\n\nSOURCE URL:\n${sourceUrl}\n\nSOURCE TEXT:\n${sourceText}`
        }
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "proofttl_verdict",
          strict: true,
          schema
        }
      },
      max_tokens: 300,
      temperature: 0
    });

    const parsed = parseAiResult(result);
    if (!parsed || !["SUPPORTED", "CONTRADICTED", "UNKNOWN"].includes(parsed.status)) {
      throw new Error("bad_ai_output");
    }

    let evidence = typeof parsed.evidence === "string" ? parsed.evidence.trim() : null;
    if (evidence && !sourceText.includes(evidence)) {
      evidence = null;
      if (parsed.status !== "UNKNOWN") {
        parsed.status = "UNKNOWN";
        parsed.reason = "model_evidence_was_not_verbatim_in_source";
        parsed.confidence = Math.min(Number(parsed.confidence) || 0, 0.25);
      }
    }

    return {
      status: parsed.status,
      evidence,
      reason: String(parsed.reason || ""),
      confidence: clampNumber(parsed.confidence, 0, 1),
      verifier: MODEL
    };
  } catch {
    return {
      status: "UNKNOWN",
      evidence: null,
      reason: "semantic_verification_failed",
      confidence: 0,
      verifier: MODEL
    };
  }
}

function deterministicCheck(claim, sourceText) {
  const lowerClaim = claim.toLowerCase();
  const lowerSource = sourceText.toLowerCase();
  const at = lowerSource.indexOf(lowerClaim);

  if (claim.length >= 12 && at !== -1) {
    return {
      status: "SUPPORTED",
      evidence: sourceText.slice(at, at + claim.length),
      reason: "exact_claim_text_found_in_source",
      confidence: 0.99,
      verifier: "deterministic-exact-match"
    };
  }

  return null;
}

function parseAiResult(result) {
  if (!result) return null;
  if (typeof result === "object" && result.status) return result;
  const candidate = result.response ?? result.result ?? result.output_text ?? result;
  if (typeof candidate === "object") return candidate;
  if (typeof candidate !== "string") return null;

  try {
    return JSON.parse(candidate);
  } catch {
    const match = candidate.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      return JSON.parse(match[0]);
    } catch {
      return null;
    }
  }
}

function isSafePublicHttpUrl(url) {
  if (!["http:", "https:"].includes(url.protocol)) return false;
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) return false;
  if (/^(127\.|0\.|10\.|192\.168\.|169\.254\.)/.test(host)) return false;
  const m = host.match(/^172\.(\d+)\./);
  if (m && Number(m[1]) >= 16 && Number(m[1]) <= 31) return false;
  if (host === "::1" || host.startsWith("fe80:") || host.startsWith("fc") || host.startsWith("fd")) return false;
  return true;
}

async function sha256(value) {
  const bytes = new TextEncoder().encode(value);
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(hash)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function clampInt(value, min, max) {
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, n));
}

function clampNumber(value, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, n));
}

function json(data, status = 200) {
  return cors(
    new Response(JSON.stringify(data, null, 2), {
      status,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store"
      }
    })
  );
}

function cors(response) {
  const headers = new Headers(response.headers);
  headers.set("access-control-allow-origin", "*");
  headers.set("access-control-allow-methods", "GET,POST,OPTIONS");
  headers.set("access-control-allow-headers", "content-type");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}
