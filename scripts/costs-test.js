import {
  HYBRID_SEMANTIC_VERIFIER,
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

  assert(SEMANTIC_MODEL === HYBRID_SEMANTIC_VERIFIER, "production semantic verifier is the hybrid pipeline");
  assert(SEMANTIC_MODEL_PRICING.model === QWEN3_MODEL, "default semantic economics use Qwen primary pricing");
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

  const qwenExpected = (7500 * 0.051 + 100 * 0.34) / 1_000_000;
  const estimated = estimateAiCostUsd(normalized);
  assert(approx(estimated, qwenExpected), "default AI cost estimate matches Qwen primary token pricing");

  const llamaExpected = (7500 * 0.293 + 100 * 2.253) / 1_000_000;
  const llamaEstimated = estimateAiCostUsd(normalized, MODEL_PRICING[LLAMA_70B_MODEL]);
  assert(approx(llamaEstimated, llamaExpected), "70B cost estimate remains available for fallback accounting");

  assert(
    estimateAiCostUsd({ prompt_tokens: 0, completion_tokens: 0 }) === 0,
    "zero-token usage produces zero estimated AI cost"
  );
  assert(estimateAiCostUsd(null) === null, "missing usage has no invented cost estimate");

  const legacySingle = buildVerificationCostSample({
    phase: "ISSUED",
    verifier: LLAMA_70B_MODEL,
    usage: normalized,
    sourceChars: 30000,
    rawSourceChars: 61000,
    result: "VERIFIED",
    status: "SUPPORTED"
  });
  assert(legacySingle.event === "proofttl_verification_cost_sample", "cost sample has a stable event name");
  assert(legacySingle.phase === "ISSUED", "cost sample records lifecycle phase");
  assert(legacySingle.source_chars === 30000, "cost sample records normalized source size");
  assert(legacySingle.raw_source_chars === 61000, "cost sample records bounded raw source size");
  assert(legacySingle.ai_invoked === true, "known single-model verifier records AI invocation");
  assert(legacySingle.ai_attempts.length === 1, "legacy single-model calls are represented as one AI attempt");
  assert(approx(legacySingle.estimated_ai_cost_usd, llamaExpected), "single-model sample includes model-specific AI cost");
  assert(legacySingle.pricing_model === LLAMA_70B_MODEL, "single-model sample pins the pricing model");

  const qwenUsage = normalizeAiUsage({ prompt_tokens: 1000, completion_tokens: 300 });
  const fallbackUsage = normalizeAiUsage({ prompt_tokens: 1000, completion_tokens: 40 });
  const hybridExpected =
    estimateAiCostUsd(qwenUsage, MODEL_PRICING[QWEN3_MODEL]) +
    estimateAiCostUsd(fallbackUsage, MODEL_PRICING[LLAMA_70B_MODEL]);

  const embeddedHybridUsage = normalizeAiUsage({
    prompt_tokens: 2000,
    completion_tokens: 340,
    ai_attempts: [
      { model: QWEN3_MODEL, outcome: "invalid_output", usage: qwenUsage },
      { model: LLAMA_70B_MODEL, outcome: "fallback_verdict", usage: fallbackUsage }
    ]
  });
  assert(embeddedHybridUsage.ai_attempts.length === 2, "normalized usage preserves embedded hybrid attempt metadata");

  const hybrid = buildVerificationCostSample({
    phase: "ISSUED",
    verifier: SEMANTIC_MODEL,
    usage: embeddedHybridUsage,
    result: "VERIFIED",
    status: "SUPPORTED"
  });
  assert(hybrid.ai_invoked === true, "hybrid pipeline samples record AI invocation from embedded attempts");
  assert(hybrid.ai_attempts.length === 2, "hybrid samples preserve both model attempts");
  assert(hybrid.pricing_model === null, "hybrid samples do not mislabel total cost as one model");
  assert(hybrid.pricing_models.includes(QWEN3_MODEL) && hybrid.pricing_models.includes(LLAMA_70B_MODEL), "hybrid samples identify both priced models");
  assert(approx(hybrid.estimated_ai_cost_usd, hybridExpected), "hybrid sample sums model-specific attempt costs");

  const incompleteHybrid = buildVerificationCostSample({
    verifier: SEMANTIC_MODEL,
    usage: {
      ai_attempts: [
        { model: QWEN3_MODEL, outcome: "invalid_output", usage: qwenUsage },
        { model: LLAMA_70B_MODEL, outcome: "fallback_error", usage: null }
      ]
    }
  });
  assert(incompleteHybrid.ai_invoked === true, "attempt metadata identifies AI work even when aggregate tokens are absent");
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
    usage: {
      ai_attempts: [
        { model: QWEN3_MODEL, outcome: "error", usage: null }
      ]
    },
    result: "REVOKED",
    status: "UNKNOWN"
  });
  assert(missingSemanticUsage.ai_invoked === true, "failed hybrid semantic attempts remain identifiable without usage metadata");
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
