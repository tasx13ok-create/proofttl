import {
  LLAMA_70B_MODEL,
  MODEL_PRICING,
  QWEN3_MODEL,
  SEMANTIC_MODEL,
  SEMANTIC_MODEL_PRICING,
  buildVerificationCostSample,
  estimateAiCostUsd,
  getModelPricing,
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

  assert(SEMANTIC_MODEL === LLAMA_70B_MODEL, "production semantic model remains 70B during accounting-only rollout");
  assert(getModelPricing(LLAMA_70B_MODEL)?.model === LLAMA_70B_MODEL, "70B pricing is addressable by model id");
  assert(getModelPricing(QWEN3_MODEL)?.model === QWEN3_MODEL, "Qwen3 pricing is addressable by model id");
  assert(getModelPricing("unknown") === null, "unknown models do not inherit a fake price");

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
  assert(approx(estimated, expected), "default AI cost estimate matches current production token pricing");

  const qwenExpected = (7500 * 0.051 + 100 * 0.34) / 1_000_000;
  const qwenEstimated = estimateAiCostUsd(normalized, MODEL_PRICING[QWEN3_MODEL]);
  assert(approx(qwenEstimated, qwenExpected), "Qwen3 cost estimate uses Qwen3 token pricing");

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
  assert(sample.ai_attempts.length === 1, "legacy single-model calls are represented as one AI attempt");
  assert(approx(sample.estimated_ai_cost_usd, expected), "cost sample includes estimated AI cost");
  assert(sample.pricing_model === SEMANTIC_MODEL, "single-model sample pins the pricing model");
  assert(
    sample.pricing_checked_at === SEMANTIC_MODEL_PRICING.checked_at,
    "single-model sample pins the pricing snapshot date"
  );

  const qwenUsage = normalizeAiUsage({ prompt_tokens: 1000, completion_tokens: 300 });
  const fallbackUsage = normalizeAiUsage({ prompt_tokens: 1000, completion_tokens: 40 });
  const hybrid = buildVerificationCostSample({
    phase: "ISSUED",
    verifier: `${QWEN3_MODEL}->${LLAMA_70B_MODEL}`,
    aiAttempts: [
      { model: QWEN3_MODEL, outcome: "invalid_output", usage: qwenUsage },
      { model: LLAMA_70B_MODEL, outcome: "fallback_verdict", usage: fallbackUsage }
    ],
    result: "VERIFIED",
    status: "SUPPORTED"
  });
  const hybridExpected =
    estimateAiCostUsd(qwenUsage, MODEL_PRICING[QWEN3_MODEL]) +
    estimateAiCostUsd(fallbackUsage, MODEL_PRICING[LLAMA_70B_MODEL]);
  assert(hybrid.ai_invoked === true, "hybrid samples record AI invocation");
  assert(hybrid.ai_attempts.length === 2, "hybrid samples preserve both model attempts");
  assert(hybrid.pricing_model === null, "hybrid samples do not mislabel total cost as one model");
  assert(hybrid.pricing_models.includes(QWEN3_MODEL) && hybrid.pricing_models.includes(LLAMA_70B_MODEL), "hybrid samples identify both priced models");
  assert(approx(hybrid.estimated_ai_cost_usd, hybridExpected), "hybrid sample sums model-specific attempt costs");

  const incompleteHybrid = buildVerificationCostSample({
    verifier: `${QWEN3_MODEL}->${LLAMA_70B_MODEL}`,
    aiAttempts: [
      { model: QWEN3_MODEL, outcome: "invalid_output", usage: qwenUsage },
      { model: LLAMA_70B_MODEL, outcome: "fallback_error", usage: null }
    ]
  });
  assert(incompleteHybrid.estimated_ai_cost_usd === null, "hybrid total cost stays unknown when any AI attempt lacks usage");

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
  assert(deterministic.ai_attempts.length === 0, "deterministic samples have no AI attempts");
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
