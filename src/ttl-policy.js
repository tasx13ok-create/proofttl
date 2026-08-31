const MIN_TTL_SECONDS = 60;
const MAX_TTL_SECONDS = 30 * 24 * 60 * 60;

const BASE_TTL = {
  VERY_HIGH: 15 * 60,
  HIGH: 6 * 60 * 60,
  MEDIUM: 3 * 24 * 60 * 60,
  LOW: 30 * 24 * 60 * 60,
};

export function deriveTtlPolicy({ claimContract, confidence = null, contradictionCount = 0, sourceCount = 1, sourceChangedRecently = false, requestedTtlSeconds = null, maxTtlSeconds = MAX_TTL_SECONDS } = {}) {
  const volatility = claimContract?.volatility?.level || "MEDIUM";
  const base = BASE_TTL[volatility] || BASE_TTL.MEDIUM;
  const reasons = [`VOLATILITY_${volatility}`];
  let multiplier = 1;

  if (Number.isFinite(confidence)) {
    if (confidence < 0.5) {
      multiplier *= 0.35;
      reasons.push("LOW_CONFIDENCE_SHORTENED");
    } else if (confidence < 0.75) {
      multiplier *= 0.7;
      reasons.push("MODERATE_CONFIDENCE_SHORTENED");
    } else if (confidence >= 0.95 && volatility !== "VERY_HIGH") {
      multiplier *= 1.2;
      reasons.push("HIGH_CONFIDENCE_EXTENDED");
    }
  }

  if (Number(contradictionCount) > 0) {
    multiplier *= 0.5;
    reasons.push("CONTRADICTION_PRESENT_SHORTENED");
  }

  if (Number(sourceCount) <= 1) {
    multiplier *= 0.8;
    reasons.push("SINGLE_SOURCE_SHORTENED");
  } else if (Number(sourceCount) >= 3) {
    multiplier *= 1.1;
    reasons.push("MULTI_SOURCE_CORROBORATION_EXTENDED");
  }

  if (sourceChangedRecently) {
    multiplier *= 0.5;
    reasons.push("RECENT_SOURCE_CHANGE_SHORTENED");
  }

  const policyTtl = clampInt(Math.round(base * multiplier), MIN_TTL_SECONDS, maxTtlSeconds);
  const explicitRequested = requestedTtlSeconds !== null && requestedTtlSeconds !== undefined && requestedTtlSeconds !== "" && Number.isFinite(Number(requestedTtlSeconds));
  const requested = explicitRequested
    ? clampInt(Number(requestedTtlSeconds), MIN_TTL_SECONDS, maxTtlSeconds)
    : null;

  const ttlSeconds = requested === null ? policyTtl : Math.min(requested, policyTtl);
  if (requested !== null) {
    reasons.push(requested <= policyTtl ? "CALLER_REQUEST_WITHIN_POLICY" : "CALLER_REQUEST_CAPPED_BY_POLICY");
  }

  return {
    version: "proofttl-ttl-policy-v1",
    volatility,
    base_ttl_seconds: base,
    policy_ttl_seconds: policyTtl,
    requested_ttl_seconds: requested,
    ttl_seconds: ttlSeconds,
    reasons,
    recheck_recommended_seconds: recommendedRecheck(ttlSeconds, volatility),
    invalidation_conditions: [
      "SOURCE_UNAVAILABLE",
      "SOURCE_FINGERPRINT_CHANGED",
      "MATERIAL_CONTRADICTION_FOUND",
      "CLAIM_SCOPE_CHANGED",
      "VERDICT_CHANGED"
    ]
  };
}

export function recommendedRecheck(ttlSeconds, volatility = "MEDIUM") {
  const ratio = volatility === "VERY_HIGH" ? 0.25 : volatility === "HIGH" ? 0.4 : volatility === "LOW" ? 0.75 : 0.55;
  return Math.max(MIN_TTL_SECONDS, Math.round(ttlSeconds * ratio));
}

function clampInt(value, min, max) {
  const parsed = Number.parseInt(value, 10);
  const safe = Number.isFinite(parsed) ? parsed : min;
  return Math.max(min, Math.min(Math.max(min, Number(max) || MAX_TTL_SECONDS), safe));
}
