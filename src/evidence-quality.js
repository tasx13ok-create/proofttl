const ENTAILMENT_STATES = new Set(["FULL_SUPPORT", "PARTIAL_SUPPORT", "CONTRADICTORY", "CONTEXT_ONLY", "IRRELEVANT", "UNKNOWN"]);
const STANCES = new Set(["FOR", "AGAINST", "AMBIGUOUS"]);

export function assessEvidence(input = {}, context = {}) {
  const observedAt = safeDate(input.observed_at) || new Date();
  const publishedAt = safeDate(input.published_at || input.updated_at);
  const volatility = context.volatility || context.claim_contract?.volatility?.level || "MEDIUM";
  const sourceType = normalizeSourceType(input.source_type, input.primary);
  const authority = clamp01(input.authority_score ?? authorityDefault(sourceType));
  const directness = clamp01(input.directness_score ?? directnessDefault(input.entailment));
  const independence = clamp01(input.independence_score ?? (input.independent === false ? 0.25 : 0.8));
  const specificity = clamp01(input.specificity_score ?? specificityDefault(input.entailment));
  const reputation = clamp01(input.reputation_score ?? 0.65);
  const freshness = freshnessScore({ observedAt, publishedAt, volatility });
  const entailment = normalizeEntailment(input.entailment);
  const stance = normalizeStance(input.stance, entailment);
  const stanceConsistent = isStanceConsistent(entailment, stance);
  const conflictPenalty = clamp01(input.conflict_of_interest ? 0.2 : 0);
  const sourceUrl = normalizeUrl(input.source_url);
  const traceableSource = isTraceableSourceUrl(sourceUrl);
  const definitiveEntailment = entailment === "FULL_SUPPORT" || entailment === "CONTRADICTORY";
  const verbatimEvidence = hasVerbatimEvidence(input.provenance?.evidence_excerpt);

  const components = { authority, directness, independence, specificity, reputation, freshness };
  const weighted = authority * 0.22 + directness * 0.22 + independence * 0.16 + specificity * 0.16 + reputation * 0.1 + freshness * 0.14;
  const entailmentMultiplier = entailment === "FULL_SUPPORT" || entailment === "CONTRADICTORY" ? 1 : entailment === "PARTIAL_SUPPORT" ? 0.75 : entailment === "CONTEXT_ONLY" ? 0.45 : entailment === "IRRELEVANT" ? 0 : 0.55;
  const qualityScore = clamp01((weighted - conflictPenalty) * entailmentMultiplier);
  const accepted = traceableSource && stanceConsistent && (!definitiveEntailment || verbatimEvidence) && qualityScore >= 0.45 && entailment !== "IRRELEVANT";

  return {
    version: "proofttl-evidence-quality-v1",
    source_url: sourceUrl,
    title: cleanText(input.title, 240),
    publisher: cleanText(input.publisher, 160),
    source_type: sourceType,
    primary: sourceType === "PRIMARY",
    observed_at: observedAt.toISOString(),
    published_at: publishedAt ? publishedAt.toISOString() : null,
    stance,
    entailment,
    quality_score: round3(qualityScore),
    accepted,
    components: mapRound3(components),
    conflict_of_interest: Boolean(input.conflict_of_interest),
    underlying_source_id: cleanText(input.underlying_source_id, 200),
    provenance: input.provenance && typeof input.provenance === "object" ? input.provenance : null,
    reasons: evidenceReasons({ sourceType, entailment, freshness, independence, conflict: Boolean(input.conflict_of_interest), qualityScore, traceableSource, definitiveEntailment, verbatimEvidence, stanceConsistent, accepted })
  };
}

export function aggregateEvidence(items = [], context = {}) {
  const assessed = dedupeEvidence(items.map((item) => assessEvidence(item, context)));
  const accepted = assessed.filter((item) => item.accepted);
  const rejected = assessed.filter((item) => !item.accepted);

  // A directional provider stance is not enough to move the ledger. Only
  // entailments that actually express support/refutation are allowed onto a
  // verdict-bearing side. CONTEXT_ONLY/UNKNOWN evidence may remain accepted as
  // useful context, but it must stay non-directional even if a provider labels
  // it FOR or AGAINST.
  const evidenceFor = accepted.filter(
    (item) => item.stance === "FOR" && (item.entailment === "FULL_SUPPORT" || item.entailment === "PARTIAL_SUPPORT")
  );
  const evidenceAgainst = accepted.filter(
    (item) => item.stance === "AGAINST" && item.entailment === "CONTRADICTORY"
  );
  const directional = new Set([...evidenceFor, ...evidenceAgainst]);
  const ambiguous = accepted.filter((item) => !directional.has(item));
  const support = sideStrength(evidenceFor);
  const contradiction = sideStrength(evidenceAgainst);
  const independentSupport = independentGroupCount(evidenceFor);
  const independentContradiction = independentGroupCount(evidenceAgainst);
  const verdict = deriveVerdict({ support, contradiction, independentSupport, independentContradiction });
  const confidence = deriveConfidence({ support, contradiction, independentSupport, independentContradiction, acceptedCount: accepted.length });

  return {
    version: "proofttl-evidence-ledger-v1",
    verdict,
    confidence,
    metrics: {
      support_strength: round3(support),
      contradiction_strength: round3(contradiction),
      independent_support_groups: independentSupport,
      independent_contradiction_groups: independentContradiction,
      accepted_count: accepted.length,
      rejected_count: rejected.length,
      ambiguous_count: ambiguous.length
    },
    evidence_for: sortEvidence(evidenceFor),
    evidence_against: sortEvidence(evidenceAgainst),
    ambiguous_evidence: sortEvidence(ambiguous),
    rejected_evidence: sortEvidence(rejected)
  };
}

export function deriveVerdict({ support = 0, contradiction = 0, independentSupport = 0, independentContradiction = 0 } = {}) {
  if (contradiction >= 0.72 && independentContradiction >= 1 && contradiction > support + 0.12) return "CONTRADICTED";
  if (support >= 0.72 && independentSupport >= 1 && support > contradiction + 0.12) return "SUPPORTED";
  return "UNKNOWN";
}

export function deriveConfidence({ support = 0, contradiction = 0, independentSupport = 0, independentContradiction = 0, acceptedCount = 0 } = {}) {
  if (!acceptedCount) return 0;
  const strongest = Math.max(support, contradiction);
  const opposition = Math.min(support, contradiction);
  const separation = Math.max(0, strongest - opposition);
  const independentGroups = Math.max(independentSupport, independentContradiction);
  const corroboration = Math.min(1, independentGroups / 3);
  const coverage = Math.min(1, acceptedCount / 4);
  return round3(clamp01(strongest * 0.45 + separation * 0.3 + corroboration * 0.15 + coverage * 0.1));
}

export function dedupeEvidence(items = []) {
  const byKey = new Map();
  for (const item of items) {
    const key = evidenceIdentity(item);
    const existing = byKey.get(key);
    if (!existing || item.quality_score > existing.quality_score) byKey.set(key, item);
  }
  return [...byKey.values()];
}

function evidenceIdentity(item) {
  if (item.underlying_source_id) return `underlying:${item.underlying_source_id.toLowerCase()}`;
  try {
    const url = new URL(item.source_url);
    const pathname = url.pathname.replace(/\/$/, "");
    return `url:${url.hostname.toLowerCase()}${pathname}`;
  } catch {
    return ["fallback", item.publisher || "unknown-publisher", item.title || "untitled", item.source_url || "no-url", item.published_at || "no-publication-time", item.entailment || "unknown-entailment", item.stance || "unknown-stance"].join(":").toLowerCase();
  }
}

function independentGroupCount(items) {
  const groups = new Set();
  for (const item of items) {
    // Independence is about distinct publishing origins, not distinct content
    // fingerprints. Different pages or revisions on one host therefore remain
    // one corroborating origin even when their underlying_source_id differs.
    // Mirrored copies sharing an underlying_source_id are already collapsed by
    // dedupeEvidence before this function runs.
    try {
      groups.add(`h:${new URL(item.source_url).hostname.toLowerCase()}`);
      continue;
    } catch {
      if (item.publisher) {
        groups.add(`p:${item.publisher.toLowerCase()}`);
        continue;
      }
    }
    if (item.underlying_source_id) groups.add(`u:${item.underlying_source_id.toLowerCase()}`);
  }
  return groups.size;
}

function sideStrength(items) {
  if (!items.length) return 0;
  const sorted = [...items].map((item) => item.quality_score).sort((a, b) => b - a);
  const top = sorted[0] || 0;
  const corroboration = sorted.slice(1, 4).reduce((sum, score, index) => sum + score * [0.35, 0.2, 0.1][index], 0);
  return clamp01(top + corroboration);
}

function freshnessScore({ observedAt, publishedAt, volatility }) {
  if (!publishedAt) return 0.55;
  const ageDays = Math.max(0, (observedAt.getTime() - publishedAt.getTime()) / 86400000);
  const halfLifeDays = volatility === "VERY_HIGH" ? 0.25 : volatility === "HIGH" ? 14 : volatility === "LOW" ? 3650 : 180;
  return clamp01(Math.exp(-Math.log(2) * ageDays / halfLifeDays));
}

function authorityDefault(sourceType) {
  return sourceType === "PRIMARY" ? 0.9 : sourceType === "SECONDARY" ? 0.7 : 0.5;
}

function directnessDefault(entailment) {
  const normalized = normalizeEntailment(entailment);
  return normalized === "FULL_SUPPORT" || normalized === "CONTRADICTORY" ? 0.9 : normalized === "PARTIAL_SUPPORT" ? 0.65 : normalized === "CONTEXT_ONLY" ? 0.4 : 0.25;
}

function specificityDefault(entailment) {
  const normalized = normalizeEntailment(entailment);
  return normalized === "FULL_SUPPORT" || normalized === "CONTRADICTORY" ? 0.9 : normalized === "PARTIAL_SUPPORT" ? 0.6 : normalized === "CONTEXT_ONLY" ? 0.35 : 0.2;
}

function normalizeSourceType(value, primary) {
  if (primary === true) return "PRIMARY";
  const normalized = String(value || "").trim().toUpperCase();
  return ["PRIMARY", "SECONDARY", "TERTIARY"].includes(normalized) ? normalized : "SECONDARY";
}

function normalizeEntailment(value) {
  const normalized = String(value || "UNKNOWN").trim().toUpperCase();
  return ENTAILMENT_STATES.has(normalized) ? normalized : "UNKNOWN";
}

function normalizeStance(value, entailment) {
  const normalized = String(value || "").trim().toUpperCase();
  if (STANCES.has(normalized)) return normalized;
  if (entailment === "CONTRADICTORY") return "AGAINST";
  if (entailment === "FULL_SUPPORT" || entailment === "PARTIAL_SUPPORT") return "FOR";
  return "AMBIGUOUS";
}

function isStanceConsistent(entailment, stance) {
  if (entailment === "FULL_SUPPORT" || entailment === "PARTIAL_SUPPORT") return stance === "FOR";
  if (entailment === "CONTRADICTORY") return stance === "AGAINST";
  return true;
}

function evidenceReasons({ sourceType, entailment, freshness, independence, conflict, qualityScore, traceableSource, definitiveEntailment, verbatimEvidence, stanceConsistent, accepted }) {
  return [
    `SOURCE_${sourceType}`,
    `ENTAILMENT_${entailment}`,
    traceableSource ? "TRACEABLE_HTTP_SOURCE" : "REJECTED_UNTRACEABLE_SOURCE",
    stanceConsistent ? "STANCE_ENTAILMENT_CONSISTENT" : "REJECTED_STANCE_ENTAILMENT_MISMATCH",
    definitiveEntailment ? (verbatimEvidence ? "VERBATIM_EVIDENCE_PRESENT" : "REJECTED_MISSING_VERBATIM_EVIDENCE") : "VERBATIM_EVIDENCE_NOT_REQUIRED",
    freshness < 0.35 ? "STALE_OR_TEMPORALLY_WEAK" : freshness > 0.8 ? "FRESH_EVIDENCE" : "MODERATE_FRESHNESS",
    independence < 0.5 ? "LOW_INDEPENDENCE" : "INDEPENDENT_OR_NEUTRAL",
    ...(conflict ? ["DISCLOSED_SOURCE_CONFLICT"] : []),
    qualityScore < 0.45 ? "REJECTED_LOW_COMPOSITE_QUALITY" : "COMPOSITE_QUALITY_PASSED",
    accepted ? "ACCEPTED_FOR_LEDGER" : "REJECTED_FROM_LEDGER"
  ];
}

function sortEvidence(items) { return [...items].sort((a, b) => b.quality_score - a.quality_score); }
function normalizeUrl(value) { try { return new URL(String(value || "")).toString(); } catch { return cleanText(value, 2048); } }
function isTraceableSourceUrl(value) { try { const url = new URL(String(value || "")); return (url.protocol === "https:" || url.protocol === "http:") && Boolean(url.hostname); } catch { return false; } }
function hasVerbatimEvidence(value) { return typeof value === "string" && Boolean(value.trim()); }
function safeDate(value) { if (!value) return null; const date = value instanceof Date ? value : new Date(value); return Number.isFinite(date.getTime()) ? date : null; }
function cleanText(value, max) { if (typeof value !== "string") return null; const text = value.trim().replace(/\s+/g, " "); return text ? text.slice(0, max) : null; }
function clamp01(value) { const numeric = Number(value); if (!Number.isFinite(numeric)) return 0; return Math.max(0, Math.min(1, numeric)); }
function round3(value) { return Math.round(Number(value) * 1000) / 1000; }
function mapRound3(object) { return Object.fromEntries(Object.entries(object).map(([key, value]) => [key, round3(value)])); }
