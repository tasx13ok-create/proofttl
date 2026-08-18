import {
  SEMANTIC_MODEL,
  SEMANTIC_MODEL_PRICING,
  buildVerificationCostSample,
  estimateAiCostUsd,
  normalizeAiUsage
} from "../src/costs.js";

let passed = 0;

function assert(condition, message) {
  if (!condition) throw new Error(message);
  passed += 1;
  console.log(`PASS ${passed}: ${message}`);
}

function approx(actual, expected, epsilon = 1e-12) {
  return Math.abs(actual - expected) <= epsilon;
}

async function run() {
  console.log("ProofTTL verification cost accounting regression test\n");

  const normalized = normalizeAiUsage({
    prompt_tokens: "7500",
    completion_tokens: 100,
    total_tokens: 7600,
    ignored: true
  });
  assert(normalized.prompt_tokens === 7500, "prompt token usage is normalized");
  assert(normalized.completion_tokens === 100, "completion token usage is normalized");
  assert(normalized.total_tokens === 7600, "total token usage is normalized");
  assert(!("ignored" in normalized), "unknown usage fields are not persisted");

  assert(normalizeAiUsage(null) === null, "missing usage normalizes to null");
  assert(
    normalizeAiUsage({ prompt_tokens: -1 }) === null,
    "negative usage values are rejected"
  );

  const expected = (7500 * 0.293 + 100 * 2.253) / 1_000_000;
  const estimated = estimateAiCostUsd(normalized);
  assert(approx(estimated, expected), "AI cost estimate matches configured token pricing");

  assert(
    estimateAiCostUsd({ prompt_tokens: 0, completion_tokens: 0 }) === 0,
    "zero-token usage produces zero estimated AI cost"
  );
  assert(estimateAiCostUsd(null) === null, "missing usage has no invented cost estimate");

  const sample = buildVerificationCostSample({
    phase: "ISSUED",
    verifier: SEMANTIC_MODEL,
    usage: normalized,
    sourceChars: 30000,
    rawSourceChars: 61000,
    result: "VERIFIED",
    status: "SUPPORTED"
  });
  assert(sample.event === "proofttl_verification_cost_sample", "cost sample has a stable event name");
  assert(sample.phase === "ISSUED", "cost sample records lifecycle phase");
  assert(sample.source_chars === 30000, "cost sample records normalized source size");
  assert(sample.raw_source_chars === 61000, "cost sample records bounded raw source size");
  assert(sample.ai_invoked === true, "semantic verifier samples record that AI was invoked");
  assert(approx(sample.estimated_ai_cost_usd, expected), "cost sample includes estimated AI cost");
  assert(sample.pricing_model === SEMANTIC_MODEL, "cost sample pins the pricing model");
  assert(
    sample.pricing_checked_at === SEMANTIC_MODEL_PRICING.checked_at,
    "cost sample pins the pricing snapshot date"
  );

  const deterministic = buildVerificationCostSample({
    phase: "ISSUED",
    verifier: "deterministic-exact-match",
    usage: null,
    sourceChars: 500,
    rawSourceChars: 700,
    result: "VERIFIED",
    status: "SUPPORTED"
  });
  assert(deterministic.ai_invoked === false, "deterministic samples record that AI was bypassed");
  assert(deterministic.estimated_ai_cost_usd === 0, "deterministic samples record zero AI cost");

  const missingSemanticUsage = buildVerificationCostSample({
    phase: "AUTO_REVERIFY",
    verifier: SEMANTIC_MODEL,
    usage: null,
    result: "REVOKED",
    status: "UNKNOWN"
  });
  assert(missingSemanticUsage.ai_invoked === true, "semantic attempts remain identifiable without usage metadata");
  assert(
    missingSemanticUsage.estimated_ai_cost_usd === null,
    "missing semantic usage is marked unknown instead of falsely zero-cost"
  );

  console.log(`\nSUCCESS: ${passed} ProofTTL cost accounting checks passed.`);
}

run().catch((error) => {
  console.error("\nCOST ACCOUNTING TEST FAILED:", error.stack || error.message);
  process.exitCode = 1;
});
