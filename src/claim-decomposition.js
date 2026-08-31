import { buildClaimContract } from "./claim-contract.js";

const MAX_INPUT_CHARS = 30000;
const DEFAULT_MAX_CLAIMS = 25;

const NON_FACTUAL_PATTERNS = [
  { reason: "QUESTION", pattern: /^\s*(?:who|what|when|where|why|how|is|are|can|could|should|would|do|does|did)\b.*\?\s*$/i },
  { reason: "OPINION", pattern: /\b(i think|i feel|in my opinion|imo|seems beautiful|is amazing|is terrible|is the best|is the worst|should be|ought to)\b/i },
  { reason: "CREATIVE_OR_IMPERATIVE", pattern: /^\s*(?:write|create|imagine|pretend|draft|generate|tell me|show me|please)\b/i },
  { reason: "CONVERSATIONAL_FILLER", pattern: /^\s*(?:thanks|thank you|okay|ok|sure|great|hello|hi|hey|sounds good|hope this helps)[.!]?\s*$/i }
];

const FACTUAL_SIGNAL = /(?:\b(?:is|are|was|were|has|have|had|became|founded|launched|released|costs?|supports?|includes?|requires?|reported|grew|declined|increased|decreased|won|died|born|located|headquartered|employs?|serves?|offers?|provides?|uses?|contains?|announced|published)\b|\d|\$|%|https?:\/\/)/i;

export function decomposeInput(input, options = {}) {
  const text = normalizeInput(input);
  if (!text) throw new Error("claim_decomposition_input_required");
  if (text.length > MAX_INPUT_CHARS) throw new Error("claim_decomposition_input_too_long");

  const maxClaims = clampInt(options.maxClaims, 1, 100, DEFAULT_MAX_CLAIMS);
  const fragments = atomicFragments(text);
  const claims = [];
  const skipped = [];

  for (const fragment of fragments) {
    if (claims.length >= maxClaims) {
      skipped.push({ text: fragment, reason: "MAX_CLAIMS_REACHED" });
      continue;
    }

    const classification = classifyFragment(fragment);
    if (!classification.verifiable) {
      skipped.push({ text: fragment, reason: classification.reason });
      continue;
    }

    let contract;
    try {
      contract = buildClaimContract(fragment, { nowMs: options.nowMs });
    } catch (error) {
      skipped.push({ text: fragment, reason: error?.message || "CLAIM_CONTRACT_FAILED" });
      continue;
    }

    claims.push({
      claim_id: `c${String(claims.length + 1).padStart(2, "0")}`,
      text: fragment,
      normalized_claim: contract.normalized_claim,
      verifiable: true,
      atomicity: inferAtomicity(fragment),
      proposition: parseProposition(contract.normalized_claim),
      verification_priority: contract.verification_priority,
      risk_if_wrong: contract.risk_if_wrong,
      volatility: contract.volatility,
      time_scope: contract.time_scope,
      geography_scope: contract.geography_scope,
      claim_contract: contract
    });
  }

  return {
    version: "proofttl-claim-decomposition-v1",
    input_chars: text.length,
    fragments_seen: fragments.length,
    claim_count: claims.length,
    skipped_count: skipped.length,
    claims,
    skipped
  };
}

export function classifyFragment(fragment) {
  const text = String(fragment || "").trim();
  if (!text || text.length < 6) return { verifiable: false, reason: "TOO_SHORT" };
  if (text.length > 1000) return { verifiable: false, reason: "TOO_LONG" };

  for (const rule of NON_FACTUAL_PATTERNS) {
    if (rule.pattern.test(text)) return { verifiable: false, reason: rule.reason };
  }

  if (!FACTUAL_SIGNAL.test(text)) return { verifiable: false, reason: "NO_FACTUAL_SIGNAL" };
  return { verifiable: true, reason: null };
}

export function atomicFragments(input) {
  const text = normalizeInput(input);
  if (!text) return [];

  const sentenceLike = text
    .replace(/\r\n?/g, "\n")
    .split(/(?<=[.!?])\s+|\n{2,}|(?:^|\n)\s*[-*•]\s+/g)
    .map(cleanFragment)
    .filter(Boolean);

  const fragments = [];
  for (const sentence of sentenceLike) {
    const clauses = splitCoordinatedFactualClauses(sentence);
    fragments.push(...clauses.map(cleanFragment).filter(Boolean));
  }
  return dedupeNormalized(fragments);
}

function splitCoordinatedFactualClauses(sentence) {
  if (sentence.length < 180) return [sentence];

  const pieces = sentence.split(/;\s+|\s+(?=but\s+)|\s+(?=however,?\s+)/i);
  if (pieces.length > 1 && pieces.every((part) => part.trim().length >= 20)) return pieces;

  const andPieces = sentence.split(/,\s+and\s+(?=[A-Z0-9])/);
  if (andPieces.length > 1 && andPieces.every((part) => FACTUAL_SIGNAL.test(part))) return andPieces;
  return [sentence];
}

function inferAtomicity(text) {
  const conjunctions = (text.match(/\b(and|or|while|whereas|although|because)\b/gi) || []).length;
  const quantities = (text.match(/\b\d[\d,.]*\b/g) || []).length;
  const score = Math.max(0, 1 - Math.min(0.75, conjunctions * 0.2 + Math.max(0, quantities - 2) * 0.1));
  return {
    score: Number(score.toFixed(2)),
    likely_atomic: score >= 0.7,
    signals: [
      ...(conjunctions ? [`CONJUNCTIONS_${conjunctions}`] : []),
      ...(quantities > 2 ? [`MULTIPLE_QUANTITIES_${quantities}`] : [])
    ]
  };
}

function parseProposition(claim) {
  const patterns = [
    /^(.+?)\s+(is|are|was|were|has|have|had)\s+(.+)$/i,
    /^(.+?)\s+(costs?|supports?|includes?|requires?|offers?|provides?|uses?|contains?|employs?|serves?)\s+(.+)$/i,
    /^(.+?)\s+(grew|declined|increased|decreased|reported|announced|published|released|launched|won)\s+(.+)$/i
  ];

  for (const pattern of patterns) {
    const match = claim.match(pattern);
    if (match) {
      return {
        subject: cleanPart(match[1]),
        predicate: cleanPart(match[2]).toLowerCase(),
        object_or_value: cleanPart(match[3])
      };
    }
  }

  return { subject: null, predicate: null, object_or_value: null };
}

function dedupeNormalized(values) {
  const seen = new Set();
  const output = [];
  for (const value of values) {
    const key = value.toLowerCase().replace(/\s+/g, " ").replace(/[.!?]+$/g, "").trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    output.push(value);
  }
  return output;
}

function normalizeInput(input) {
  return typeof input === "string" ? input.normalize("NFKC").trim().replace(/[ \t]+/g, " ") : "";
}

function cleanFragment(value) {
  return String(value || "").trim().replace(/^[-*•]\s*/, "").replace(/\s+/g, " ");
}

function cleanPart(value) {
  const text = String(value || "").trim().replace(/[.!?]+$/g, "");
  return text || null;
}

function clampInt(value, min, max, fallback) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}
