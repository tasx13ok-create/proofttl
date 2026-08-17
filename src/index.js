const MODEL = "@cf/meta/llama-3.1-8b-instruct-fast";
const SERVICE_VERSION = "0.3.0";
const PROTOCOL = "ProofTTL/0.3";
const DEFAULT_TTL = 3600;
const MAX_TTL = 604800;
const MAX_SOURCE_CHARS = 30000;
const MAX_HISTORY = 20;
const MAX_AUTO_CHECKS_PER_RUN = 10;
const MAX_REDIRECTS = 5;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") return cors(new Response(null, { status: 204 }));

    if (request.method === "GET" && url.pathname === "/") {
      return json({
        name: "ProofTTL",
        version: SERVICE_VERSION,
        protocol: PROTOCOL,
        description: "Expiring, source-backed fact leases for machines.",
        endpoints: {
          health: "GET /health",
          verify: "POST /verify",
          lease: "GET /lease/:id",
          reverify: "POST /lease/:id/reverify",
          monitor: "GET /monitor/status"
        }
      });
    }

    if (request.method === "GET" && url.pathname === "/health") {
      return json({
        ok: true,
        service: "proofttl",
        version: SERVICE_VERSION,
        protocol: PROTOCOL,
        time: new Date().toISOString(),
        storage: Boolean(env.LEASES),
        ai: Boolean(env.AI),
        automatic_monitoring: Boolean(env.LEASES)
      });
    }

    if (request.method === "GET" && url.pathname === "/monitor/status") {
      return handleMonitorStatus(env);
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
  },

  async scheduled(controller, env, ctx) {
    ctx.waitUntil(runMonitor(env, controller.scheduledTime));
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
  const monitorIntervalSeconds = chooseMonitorInterval(ttlSeconds);

  const firstCheck = makeCheck({
    kind: "ISSUED",
    observedAt: observedAt.toISOString(),
    fingerprint,
    finalUrl: fetched.finalUrl,
    verdict
  });

  const lease = {
    lease_id: leaseId,
    protocol: PROTOCOL,
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
    last_source_fingerprint: fingerprint,
    confidence: verdict.confidence,
    verifier: verdict.verifier,
    lease_state: "ACTIVE",
    verification_count: 1,
    last_checked_at: observedAt.toISOString(),
    last_check: firstCheck,
    history: [firstCheck],
    monitor_interval_seconds: monitorIntervalSeconds,
    next_check_at: nextCheckTime(observedAt.getTime(), monitorIntervalSeconds, expiresAt.getTime())
  };

  await saveLease(env, lease);
  return json(lease);
}

async function handleLeaseGet(id, env) {
  if (!id) return json({ error: "lease_id_required" }, 400);
  if (!env.LEASES) return json({ error: "persistent_storage_not_configured" }, 503);

  const lease = await loadLease(env, id);
  if (!lease) return json({ error: "lease_not_found" }, 404);

  const changed = applyExpiryState(lease);
  if (changed) await saveLease(env, lease);
  return json(lease);
}

async function handleReverify(id, env) {
  if (!id) return json({ error: "lease_id_required" }, 400);
  if (!env.LEASES) return json({ error: "persistent_storage_not_configured" }, 503);

  const lease = await loadLease(env, id);
  if (!lease) return json({ error: "lease_not_found" }, 404);

  const check = await reverifyLease(lease, env, "REVERIFY", true);
  return json({ lease, check });
}

async function handleMonitorStatus(env) {
  if (!env.LEASES) return json({ error: "persistent_storage_not_configured" }, 503);
  const raw = await env.LEASES.get("monitor:last_run");
  return json({
    enabled: true,
    schedule: "every_minute",
    max_checks_per_run: MAX_AUTO_CHECKS_PER_RUN,
    last_run: raw ? JSON.parse(raw) : null
  });
}

async function runMonitor(env, scheduledTime) {
  if (!env.LEASES) return;

  const now = Number.isFinite(scheduledTime) ? scheduledTime : Date.now();
  const startedAt = new Date().toISOString();
  let keysScanned = 0;
  let due = 0;
  let checked = 0;
  let revoked = 0;
  let expired = 0;
  let errors = 0;

  try {
    const listed = await env.LEASES.list({ prefix: "lease:", limit: 1000 });
    keysScanned = listed.keys.length;

    for (const key of listed.keys) {
      if (checked >= MAX_AUTO_CHECKS_PER_RUN) break;

      const metadata = key.metadata || null;
      if (metadata?.lease_state && metadata.lease_state !== "ACTIVE") continue;

      const metadataExpiry = metadata?.expires_at ? Date.parse(metadata.expires_at) : NaN;
      if (Number.isFinite(metadataExpiry) && metadataExpiry <= now) {
        const id = key.name.slice("lease:".length);
        const lease = await loadLease(env, id);
        if (!lease) continue;
        if (applyExpiryState(lease, now)) {
          await saveLease(env, lease);
          expired += 1;
        }
        continue;
      }

      const metadataNext = metadata?.next_check_at ? Date.parse(metadata.next_check_at) : NaN;
      if (Number.isFinite(metadataNext) && metadataNext > now) continue;

      const id = key.name.slice("lease:".length);
      const lease = await loadLease(env, id);
      if (!lease) continue;

      if (applyExpiryState(lease, now)) {
        await saveLease(env, lease);
        expired += 1;
        continue;
      }

      if (lease.lease_state !== "ACTIVE") continue;
      if (lease.next_check_at && Date.parse(lease.next_check_at) > now) continue;

      due += 1;
      try {
        const check = await reverifyLease(lease, env, "AUTO_REVERIFY", false, now);
        checked += 1;
        if (check.result === "REVOKED") revoked += 1;
      } catch (error) {
        errors += 1;
        console.error("ProofTTL automatic reverify failed", id, error?.message || error);
      }
    }
  } catch (error) {
    errors += 1;
    console.error("ProofTTL monitor run failed", error?.message || error);
  }

  const summary = {
    started_at: startedAt,
    finished_at: new Date().toISOString(),
    scheduled_for: new Date(now).toISOString(),
    keys_scanned: keysScanned,
    due,
    checked,
    revoked,
    expired,
    errors
  };

  await env.LEASES.put("monitor:last_run", JSON.stringify(summary), { expirationTtl: 86400 });
}

async function reverifyLease(lease, env, kind = "REVERIFY", allowExpired = true, nowMs = Date.now()) {
  applyExpiryState(lease, nowMs);
  const checkedAt = new Date(nowMs);

  if (!allowExpired && lease.lease_state !== "ACTIVE") {
    const check = {
      kind,
      checked_at: checkedAt.toISOString(),
      result: `SKIPPED_${lease.lease_state}`,
      status: lease.status
    };
    return check;
  }

  const fetched = await fetchSource(
    lease.source_url,
    Number(env.PROOFTTL_MAX_SOURCE_CHARS || MAX_SOURCE_CHARS)
  );

  if (!fetched.ok) {
    const check = {
      kind,
      checked_at: checkedAt.toISOString(),
      result: "SOURCE_UNAVAILABLE",
      status: "UNKNOWN",
      reason: fetched.reason
    };
    recordCheck(lease, check, checkedAt.getTime());
    scheduleNextCheck(lease, checkedAt.getTime(), 60);
    await saveLease(env, lease);
    return check;
  }

  const currentFingerprint = `sha256:${await sha256(fetched.normalizedText)}`;
  const comparisonFingerprint = lease.last_source_fingerprint || lease.source_fingerprint;

  if (currentFingerprint === comparisonFingerprint) {
    const check = {
      kind,
      checked_at: checkedAt.toISOString(),
      result: "UNCHANGED_SOURCE",
      status: lease.status,
      source_fingerprint: currentFingerprint,
      final_url: fetched.finalUrl
    };
    recordCheck(lease, check, checkedAt.getTime());
    scheduleNextCheck(lease, checkedAt.getTime());
    await saveLease(env, lease);
    return check;
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

  lease.last_source_fingerprint = currentFingerprint;
  lease.last_observed_at = checkedAt.toISOString();

  const check = {
    kind,
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

  recordCheck(lease, check, checkedAt.getTime());
  scheduleNextCheck(lease, checkedAt.getTime());
  await saveLease(env, lease);
  return check;
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

function recordCheck(lease, check, nowMs = Date.now()) {
  lease.verification_count = Number(lease.verification_count || 0) + 1;
  lease.last_checked_at = check.checked_at;
  lease.last_check = check;
  const history = Array.isArray(lease.history) ? lease.history : [];
  history.push(check);
  lease.history = history.slice(-MAX_HISTORY);
  applyExpiryState(lease, nowMs);
}

function applyExpiryState(lease, nowMs = Date.now()) {
  if (lease.lease_state !== "REVOKED" && Date.parse(lease.expires_at) <= nowMs) {
    const changed = lease.lease_state !== "EXPIRED" || lease.next_check_at !== null;
    lease.lease_state = "EXPIRED";
    lease.next_check_at = null;
    return changed;
  }
  return false;
}

function chooseMonitorInterval(ttlSeconds) {
  return Math.max(60, Math.min(3600, Math.floor(ttlSeconds / 3)));
}

function nextCheckTime(fromMs, intervalSeconds, expiryMs) {
  const candidate = fromMs + intervalSeconds * 1000;
  if (candidate >= expiryMs) return new Date(expiryMs).toISOString();
  return new Date(candidate).toISOString();
}

function scheduleNextCheck(lease, fromMs = Date.now(), forcedSeconds = null) {
  if (lease.lease_state !== "ACTIVE") {
    lease.next_check_at = null;
    return;
  }

  const interval = forcedSeconds || Number(lease.monitor_interval_seconds) || chooseMonitorInterval(Number(lease.ttl_seconds || DEFAULT_TTL));
  lease.monitor_interval_seconds = interval;
  lease.next_check_at = nextCheckTime(fromMs, interval, Date.parse(lease.expires_at));
}

async function loadLease(env, id) {
  const raw = await env.LEASES.get(`lease:${id}`);
  if (!raw) return null;

  const lease = JSON.parse(raw);
  if (!lease.issued_at) lease.issued_at = lease.observed_at || null;
  if (!lease.last_source_fingerprint) lease.last_source_fingerprint = lease.source_fingerprint || null;
  if (!Number.isFinite(Number(lease.monitor_interval_seconds))) {
    lease.monitor_interval_seconds = chooseMonitorInterval(Number(lease.ttl_seconds || DEFAULT_TTL));
  }
  if (lease.lease_state === "ACTIVE" && !lease.next_check_at) {
    const from = Date.parse(lease.last_checked_at || lease.observed_at || lease.issued_at || new Date().toISOString());
    lease.next_check_at = nextCheckTime(from, lease.monitor_interval_seconds, Date.parse(lease.expires_at));
  }
  return lease;
}

async function saveLease(env, lease) {
  if (!env.LEASES) return;

  const retentionSeconds = Math.max(
    Math.ceil((Date.parse(lease.expires_at) - Date.now()) / 1000) + 86400,
    86400
  );

  await env.LEASES.put(`lease:${lease.lease_id}`, JSON.stringify(lease), {
    expirationTtl: retentionSeconds,
    metadata: {
      lease_state: lease.lease_state,
      expires_at: lease.expires_at,
      next_check_at: lease.next_check_at || null
    }
  });
}

async function fetchSource(sourceUrl, maxChars) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);

  try {
    let current = new URL(sourceUrl);

    for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects += 1) {
      if (!isSafePublicHttpUrl(current)) return { ok: false, reason: "source_url_not_allowed" };

      const response = await fetch(current.toString(), {
        redirect: "manual",
        signal: controller.signal,
        headers: {
          "User-Agent": "ProofTTL/0.3 (+source-backed fact verification)",
          "Accept": "text/html,text/plain,application/json;q=0.9,*/*;q=0.1"
        }
      });

      if ([301, 302, 303, 307, 308].includes(response.status)) {
        if (redirects === MAX_REDIRECTS) return { ok: false, reason: "too_many_source_redirects" };
        const location = response.headers.get("location");
        if (!location) return { ok: false, reason: "source_redirect_missing_location" };
        try {
          current = new URL(location, current);
        } catch {
          return { ok: false, reason: "invalid_source_redirect" };
        }
        continue;
      }

      if (!response.ok) return { ok: false, reason: `source_http_${response.status}` };

      const contentType = response.headers.get("content-type") || "";
      if (!/(text\/|application\/json|application\/ld\+json|application\/xml|application\/xhtml\+xml)/i.test(contentType)) {
        return { ok: false, reason: "unsupported_source_content_type" };
      }

      const raw = (await response.text()).slice(0, maxChars * 3);
      const normalizedText = normalizeSource(raw, contentType).slice(0, maxChars);
      if (normalizedText.length < 20) return { ok: false, reason: "source_contains_too_little_text" };

      return { ok: true, finalUrl: current.toString(), normalizedText };
    }

    return { ok: false, reason: "too_many_source_redirects" };
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
