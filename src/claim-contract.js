const MAX_CLAIM_CHARS = 1000;

const VOLATILITY_RULES = [
  { id: "REALTIME", pattern: /\b(now|currently|today|tonight|live|real[- ]time|weather|temperature|score|stock price|exchange rate|breaking)\b/i, level: "VERY_HIGH" },
  { id: "COMMERCIAL_DYNAMIC", pattern: /\b(price|pricing|costs?|plan|tier|available|availability|supports?|feature|integration|model|version|limit|quota|inventory|in stock|certified|certification)\b/i, level: "HIGH" },
  { id: "ROLE_POLICY", pattern: /\b(ceo|president|chair|director|owner|policy|law|regulation|status|membership|employee|employees|customer|customers|subscriber|subscribers)\b/i, level: "MEDIUM" },
  { id: "HISTORICAL", pattern: /\b(was born|born in|founded in|died in|occurred in|happened in|published in|won in|historical|history)\b/i, level: "LOW" },
];

const RISK_RULES = [
  { id: "COMPLIANCE", pattern: /\b(certified|certification|compliant|compliance|soc 2|hipaa|gdpr|iso 27001|licensed|license)\b/i, score: 3 },
  { id: "MONEY", pattern: /\b(price|pricing|cost|revenue|market|valuation|million|billion|percent|%|growth|roi)\b/i, score: 2 },
  { id: "DECISION", pattern: /\b(supports?|available|includes?|requires?|guarantees?|compatible|integration|limit|policy|legal|regulation)\b/i, score: 2 },
  { id: "QUANTIFIED", pattern: /(?:\$|€|£)?\b\d[\d,.]*(?:\s?(?:%|percent|million|billion|thousand|k|m|b))?\b/i, score: 1 },
];

export function buildClaimContract(input, options = {}) {
  const original = normalizeOriginal(input);
  if (!original) throw new Error("claim_contract_claim_required");
  if (original.length > MAX_CLAIM_CHARS) throw new Error("claim_contract_claim_too_long");

  const normalized = normalizeClaim(original);
  const volatility = inferVolatility(normalized);
  const risk = inferRisk(normalized);
  const timeScope = inferTimeScope(normalized, options.nowMs);
  const geography = inferGeography(normalized);
  const quantities = extractQuantities(normalized);
  const ambiguities = inferAmbiguities(normalized);

  return {
    version: "proofttl-claim-contract-v1",
    original_claim: original,
    normalized_claim: normalized,
    subject_hint: inferSubject(normalized),
    quantities,
    time_scope: timeScope,
    geography_scope: geography,
    volatility,
    verification_priority: priorityFromRiskAndVolatility(risk.score, volatility.level),
    risk_if_wrong: risk,
    ambiguities,
    exclusions: [],
    evidence_test: {
      support: "Evidence must directly support the normalized proposition within its stated scope and time window.",
      contradiction: "Evidence must directly negate a material part of the normalized proposition or show that its scope/time conditions fail.",
      insufficient: "Relevant evidence exists but does not establish or negate the proposition strongly enough for a supported or contradicted verdict."
    }
  };
}

export function normalizeClaim(input) {
  return String(input || "")
    .normalize("NFKC")
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[.!?]+$/g, "")
    .trim();
}

export function inferVolatility(claim) {
  for (const rule of VOLATILITY_RULES) {
    if (rule.pattern.test(claim)) return { level: rule.level, reason: rule.id };
  }
  return { level: "MEDIUM", reason: "DEFAULT_UNKNOWN_CHANGE_RATE" };
}

export function inferRisk(claim) {
  const signals = [];
  let score = 0;
  for (const rule of RISK_RULES) {
    if (rule.pattern.test(claim)) {
      signals.push(rule.id);
      score += rule.score;
    }
  }
  score = Math.min(5, score);
  return {
    level: score >= 4 ? "HIGH" : score >= 2 ? "MEDIUM" : "LOW",
    score,
    signals
  };
}

function normalizeOriginal(input) {
  return typeof input === "string" ? input.trim().replace(/\s+/g, " ") : "";
}

function inferSubject(claim) {
  const firstClause = claim.split(/\b(?:is|are|was|were|has|have|had|costs?|supports?|includes?|provides?|offers?)\b/i)[0]?.trim();
  return firstClause && firstClause.length <= 160 ? firstClause : null;
}

function extractQuantities(claim) {
  const matches = claim.match(/(?:\$|€|£)?\b\d[\d,.]*(?:\s?(?:%|percent|million|billion|thousand|k|m|b|years?|months?|days?|hours?|minutes?|seconds?))?\b/gi) || [];
  return [...new Set(matches.map((value) => value.trim()))].slice(0, 12);
}

function inferTimeScope(claim, nowMs = Date.now()) {
  const explicitYears = [...claim.matchAll(/\b(19|20)\d{2}\b/g)].map((m) => Number(m[0]));
  if (explicitYears.length) {
    return { type: "EXPLICIT", values: [...new Set(explicitYears)].slice(0, 8) };
  }
  if (/\b(now|currently|today|live|current)\b/i.test(claim)) {
    const at = Number.isFinite(nowMs) ? nowMs : Date.now();
    return { type: "CURRENT", observed_context: new Date(at).toISOString() };
  }
  return { type: "UNSPECIFIED" };
}

function inferGeography(claim) {
  const known = claim.match(/\b(United States|U\.S\.|US|United Kingdom|U\.K\.|UK|European Union|EU|Canada|Australia|California|New York|Texas|Florida)\b/gi) || [];
  return known.length ? { type: "EXPLICIT_HINT", values: [...new Set(known)] } : { type: "UNSPECIFIED" };
}

function inferAmbiguities(claim) {
  const ambiguities = [];
  if (/\b(about|approximately|roughly|around|many|most|significant|major|best|leading)\b/i.test(claim)) ambiguities.push("VAGUE_QUALIFIER");
  if (/\b(current|currently|today|now)\b/i.test(claim)) ambiguities.push("TIME_SENSITIVE_WITHOUT_EXPLICIT_EFFECTIVE_DATE");
  if (/\b(this|that|these|those|it|they)\b/i.test(claim) && !/^["']?\b(it|they)\b/i.test(claim)) ambiguities.push("POSSIBLE_CONTEXT_DEPENDENCY");
  return ambiguities;
}

function priorityFromRiskAndVolatility(riskScore, volatility) {
  const volatilityScore = volatility === "VERY_HIGH" ? 3 : volatility === "HIGH" ? 2 : volatility === "MEDIUM" ? 1 : 0;
  const combined = Math.min(8, riskScore + volatilityScore);
  return combined >= 6 ? "CRITICAL" : combined >= 4 ? "HIGH" : combined >= 2 ? "MEDIUM" : "LOW";
}
