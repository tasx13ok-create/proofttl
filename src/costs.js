export const LLAMA_70B_MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";
export const QWEN3_MODEL = "@cf/qwen/qwen3-30b-a3b-fp8";
export const HYBRID_SEMANTIC_VERIFIER =
  "proofttl-hybrid:qwen3-primary+llama70b-fallback";

// Production semantic verification is a ProofTTL routing pipeline. Qwen3 is
// the primary priced model; 70B is retained as a selective fallback.
export const SEMANTIC_MODEL = HYBRID_SEMANTIC_VERIFIER;

// Cloudflare Workers AI public unit pricing checked 2026-08-17.
// Keep this explicit and versioned so pricing decisions are reproducible.
export const MODEL_PRICING = Object.freeze({
  [LLAMA_70B_MODEL]: Object.freeze({
    model: LLAMA_70B_MODEL,
    input_usd_per_million_tokens: 0.293,
    output_usd_per_million_tokens: 2.253,
    checked_at: "2026-08-17"
  }),
  [QWEN3_MODEL]: Object.freeze({
    model: QWEN3_MODEL,
    input_usd_per_million_tokens: 0.051,
    output_usd_per_million_tokens: 0.34,
    checked_at: "2026-08-17"
  })
});

// Default economics use the primary model price. Hybrid attempt logs carry
// their own model IDs so fallback cost is accounted for separately.
export const SEMANTIC_MODEL_PRICING = MODEL_PRICING[QWEN3_MODEL];

export function getModelPricing(model) {
  return MODEL_PRICING[String(model || "")] || null;
}

export function normalizeAiUsage(usage) {
  if (!usage || typeof usage !== "object") return null;

  const normalized = normalizeTokenUsage(usage) || {};
  const attempts = normalizeEmbeddedAttempts(usage.ai_attempts);
  if (attempts.length > 0) normalized.ai_attempts = attempts;

  return Object.keys(normalized).length > 0 ? normalized : null;
}

export function estimateAiCostUsd(
  usage,
  pricing = SEMANTIC_MODEL_PRICING
) {
  const normalized = normalizeAiUsage(usage);
  if (!normalized) return null;

  const promptTokens = normalized.prompt_tokens || 0;
  const completionTokens = normalized.completion_tokens || 0;

  const inputRate = Number(pricing?.input_usd_per_million_tokens);
  const outputRate = Number(pricing?.output_usd_per_million_tokens);
  if (!Number.isFinite(inputRate) || inputRate < 0) return null;
  if (!Number.isFinite(outputRate) || outputRate < 0) return null;

  const cost =
    (promptTokens * inputRate + completionTokens * outputRate) /
    1_000_000;

  return roundUsd(cost);
}

export function buildVerificationCostSample({
  phase,
  verifier,
  usage,
  aiAttempts = null,
  sourceChars,
  rawSourceChars,
  result,
  status
}) {
  const verifierName = String(verifier || "unknown");
  const normalizedUsage = normalizeAiUsage(usage);
  const embeddedAttempts = normalizedUsage?.ai_attempts || null;
  const attempts = normalizeAttempts(
    aiAttempts ?? embeddedAttempts,
    verifierName,
    normalizedUsage
  );
  const aiInvoked = attempts.length > 0;

  let estimatedAiCostUsd = 0;
  let totalKnown = true;
  const attemptBreakdown = attempts.map((attempt) => {
    const pricing = getModelPricing(attempt.model);
    const attemptCost = attempt.usage && pricing
      ? estimateAiCostUsd(attempt.usage, pricing)
      : null;

    if (attemptCost === null) totalKnown = false;
    else estimatedAiCostUsd += attemptCost;

    return {
      model: attempt.model,
      outcome: attempt.outcome,
      usage: attempt.usage,
      estimated_ai_cost_usd: attemptCost,
      pricing_checked_at: pricing?.checked_at || null
    };
  });

  if (aiInvoked && !totalKnown) estimatedAiCostUsd = null;
  if (!aiInvoked) estimatedAiCostUsd = 0;

  const pricingModels = [...new Set(attempts.map((attempt) => attempt.model))];
  const checkedDates = [...new Set(
    pricingModels
      .map((model) => getModelPricing(model)?.checked_at)
      .filter(Boolean)
  )];

  return {
    event: "proofttl_verification_cost_sample",
    phase: String(phase || "UNKNOWN"),
    verifier: verifierName,
    result: result ? String(result) : null,
    status: status ? String(status) : null,
    source_chars: finiteNonNegative(sourceChars),
    raw_source_chars: finiteNonNegative(rawSourceChars),
    ai_invoked: aiInvoked,
    ai_usage: normalizedUsage,
    ai_attempts: attemptBreakdown,
    estimated_ai_cost_usd: estimatedAiCostUsd,
    pricing_model: pricingModels.length === 1 ? pricingModels[0] : null,
    pricing_models: pricingModels,
    pricing_checked_at: checkedDates.length === 1 ? checkedDates[0] : null
  };
}

function normalizeAttempts(aiAttempts, verifierName, fallbackUsage) {
  if (Array.isArray(aiAttempts)) {
    return aiAttempts
      .map((attempt) => {
        const model = String(attempt?.model || "");
        if (!getModelPricing(model)) return null;
        return {
          model,
          outcome: attempt?.outcome ? String(attempt.outcome) : null,
          usage: normalizeTokenUsage(attempt?.usage)
        };
      })
      .filter(Boolean);
  }

  const model = knownModelFromVerifier(verifierName);
  if (!model) return [];
  return [{ model, outcome: null, usage: normalizeTokenUsage(fallbackUsage) }];
}

function normalizeEmbeddedAttempts(attempts) {
  if (!Array.isArray(attempts)) return [];
  return attempts
    .map((attempt) => {
      const model = String(attempt?.model || "");
      if (!getModelPricing(model)) return null;
      return {
        model,
        outcome: attempt?.outcome ? String(attempt.outcome) : null,
        usage: normalizeTokenUsage(attempt?.usage)
      };
    })
    .filter(Boolean);
}

function normalizeTokenUsage(usage) {
  if (!usage || typeof usage !== "object") return null;

  const promptTokens = finiteNonNegative(usage.prompt_tokens);
  const completionTokens = finiteNonNegative(usage.completion_tokens);
  const totalTokens = finiteNonNegative(usage.total_tokens);

  const normalized = {};
  if (promptTokens !== null) normalized.prompt_tokens = promptTokens;
  if (completionTokens !== null) normalized.completion_tokens = completionTokens;
  if (totalTokens !== null) normalized.total_tokens = totalTokens;

  return Object.keys(normalized).length > 0 ? normalized : null;
}

function knownModelFromVerifier(verifierName) {
  for (const model of Object.keys(MODEL_PRICING)) {
    if (verifierName.includes(model)) return model;
  }
  return null;
}

function finiteNonNegative(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) return null;
  return number;
}

function roundUsd(value) {
  return Math.round(value * 1e12) / 1e12;
}
