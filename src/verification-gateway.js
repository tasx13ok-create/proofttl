import { verifyLeaseAgainstTrustedJwks } from "./lease-signing.js";

const DEFAULTS = Object.freeze({
  maxClaims: 20,
  ttlSeconds: 3600,
  requireSignedLease: true,
  requireEvidence: true
});

const ALLOWED_VERDICTS = new Set(["SUPPORTED", "CONTRADICTED", "UNKNOWN"]);
const ALLOWED_RISK_LEVELS = new Set(["low", "medium", "high", "critical"]);
const RISK_RANK = Object.freeze({ low: 0, medium: 1, high: 2, critical: 3 });

function normalizeText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function validHttpUrl(value) {
  try {
    const url = new URL(value);
    return (
      (url.protocol === "https:" || url.protocol === "http:") &&
      !url.username &&
      !url.password &&
      !url.hostname.endsWith(".localhost") &&
      url.hostname !== "localhost"
    );
  } catch {
    return false;
  }
}

function safeErrorCode(error) {
  const code = error && typeof error.code === "string" ? error.code : "";
  return /^[a-z0-9_]{1,64}$/i.test(code) ? code : "verification_unavailable";
}

async function normalizeResult(result, claim, nowMs, requireSignedLease, requireEvidence, trustedJwks, revokedKeyIds) {
  const verdict = normalizeText(result?.current_status || result?.issued_status || result?.status).toUpperCase();
  const leaseState = normalizeText(result?.lease_state).toUpperCase();
  const expiresAt = Date.parse(result?.expires_at || "");
  const evidence = normalizeText(result?.evidence);
  const sourceUrl = normalizeText(result?.final_url || result?.source_url);
  const signedLease = result?.lease && typeof result.lease === "object" ? result.lease : result;
  const signatureVerified = requireSignedLease
    ? Boolean(trustedJwks && await verifyLeaseAgainstTrustedJwks(signedLease, trustedJwks, revokedKeyIds || []))
    : false;

  if (!ALLOWED_VERDICTS.has(verdict)) {
    return { ok: false, verdict: "UNKNOWN", reason: "invalid_or_missing_verdict" };
  }
  if (verdict !== "SUPPORTED") {
    return { ok: false, verdict, reason: "claim_not_supported" };
  }
  if (leaseState !== "ACTIVE") {
    return { ok: false, verdict, reason: "lease_not_active" };
  }
  if (!Number.isFinite(expiresAt) || expiresAt <= nowMs) {
    return { ok: false, verdict, reason: "lease_expired_or_missing_expiry" };
  }
  if (!validHttpUrl(sourceUrl)) {
    return { ok: false, verdict, reason: "verified_source_missing_or_invalid" };
  }
  if (requireEvidence && !evidence) {
    return { ok: false, verdict, reason: "evidence_missing" };
  }
  if (requireSignedLease && !signatureVerified) {
    return { ok: false, verdict, reason: "signed_lease_not_verified" };
  }

  return {
    ok: true,
    verdict,
    lease_id: normalizeText(result?.lease_id) || null,
    lease_state: leaseState,
    expires_at: new Date(expiresAt).toISOString(),
    source_url: sourceUrl,
    evidence,
    signature_verified: signatureVerified
  };
}

/**
 * Enforce a release gate for an AI-generated draft.
 *
 * The host application MUST provide a complete inventory of atomic factual
 * claims. verifyClaim must call ProofTTL and validate the signed lease against
 * ProofTTL's published keys before returning signature_verified: true.
 * This function intentionally has no provider SDK or payment implementation.
 *
 * The caller must release only result.response. When blocked, response is null.
 */
export async function evaluateVerificationGate({
  draft,
  claims,
  inventoryComplete,
  verifyClaim,
  now = Date.now(),
  policy = {}
}) {
  const maxClaims = Number.isInteger(policy.maxClaims) && policy.maxClaims > 0
    ? Math.min(policy.maxClaims, 100)
    : DEFAULTS.maxClaims;
  const ttlSeconds = Number.isInteger(policy.ttlSeconds) && policy.ttlSeconds > 0
    ? Math.min(policy.ttlSeconds, 604800)
    : DEFAULTS.ttlSeconds;
  const requireSignedLease = policy.requireSignedLease !== false;
  const requireEvidence = policy.requireEvidence !== false;
  const minimumRisk = normalizeText(policy.minimumRisk || "low").toLowerCase();
  if (!Object.hasOwn(RISK_RANK, minimumRisk)) return {
    decision: "BLOCKED", response: null, reason: "host_minimum_risk_invalid", claims_checked: 0, claims: []
  };

  const block = (reason, items = []) => ({
    decision: "BLOCKED",
    response: null,
    reason,
    claims_checked: items.length,
    claims: items
  });

  if (typeof draft !== "string" || !draft.trim()) return block("draft_missing");
  if (typeof verifyClaim !== "function") return block("verifier_not_configured");\n  if (requireSignedLease && (!policy.trustedJwks || !Array.isArray(policy.trustedJwks.keys || policy.trustedJwks))) return block("trusted_signing_keys_not_configured");
  if (inventoryComplete !== true) return block("claim_inventory_not_confirmed_complete");
  if (!Array.isArray(claims) || claims.length === 0) return block("claim_inventory_empty");
  if (claims.length > maxClaims) return block("claim_limit_exceeded");

  const ids = new Set();
  const prepared = [];
  for (const item of claims) {
    const id = normalizeText(item?.id);
    const text = normalizeText(item?.text);
    const sourceUrl = normalizeText(item?.source_url);
    const risk = normalizeText(item?.risk).toLowerCase();

    if (!id || ids.has(id)) return block("claim_ids_missing_or_duplicated", prepared);
    ids.add(id);
    if (!text || !draft.includes(text)) return block("claim_not_bound_to_draft", prepared);
    if (!ALLOWED_RISK_LEVELS.has(risk)) return block("claim_risk_missing_or_invalid", prepared);
    if (RISK_RANK[risk] < RISK_RANK[minimumRisk]) return block("claim_below_host_minimum_risk", prepared);
    if (!validHttpUrl(sourceUrl)) return block("claim_source_url_invalid", prepared);

    prepared.push({ id, text, source_url: sourceUrl, risk });
  }

  const results = [];
  for (const claim of prepared) {
    try {
      const raw = await verifyClaim({
        claim: claim.text,
        source_url: claim.source_url,
        ttl_seconds: ttlSeconds,
        claim_id: claim.id
      });
      const normalized = normalizeResult(
        raw,
        claim,
        Number.isFinite(now) ? now : Date.now(),
        requireSignedLease,
        requireEvidence
      );
      results.push({
        id: claim.id,
        risk: claim.risk,
        verdict: normalized.verdict,
        ok: normalized.ok,
        reason: normalized.reason || null,
        ...(normalized.ok ? {
          lease_id: normalized.lease_id,
          lease_state: normalized.lease_state,
          expires_at: normalized.expires_at,
          source_url: normalized.source_url,
          evidence: normalized.evidence,
          signature_verified: normalized.signature_verified
        } : {})
      });
    } catch (error) {
      results.push({
        id: claim.id,
        risk: claim.risk,
        verdict: "UNKNOWN",
        ok: false,
        reason: safeErrorCode(error)
      });
    }
  }

  const failed = results.filter(item => !item.ok);
  if (failed.length) {
    return {
      decision: "BLOCKED",
      response: null,
      reason: "one_or_more_claims_failed_verification",
      claims_checked: results.length,
      claims: results,
      failed_claim_ids: failed.map(item => item.id)
    };
  }

  return {
    decision: "ALLOW",
    response: draft,
    reason: "all_inventory_claims_supported_by_active_signed_leases",
    claims_checked: results.length,
    claims: results,
    failed_claim_ids: []
  };
}

export const verificationGatewayDefaults = DEFAULTS;
