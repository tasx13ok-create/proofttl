export const SEMANTIC_MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";

// Cloudflare Workers AI public unit pricing checked 2026-08-17.
// Keep this explicit and versioned so pricing decisions are reproducible.
export const SEMANTIC_MODEL_PRICING = Object.freeze({
  model: SEMANTIC_MODEL,
  input_usd_per_million_tokens: 0.293,
  output_usd_per_million_tokens: 2.253,
  checked_at: "2026-08-17"
});

export function normalizeAiUsage(usage) {
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
  sourceChars,
  rawSourceChars,
  result,
  status
}) {
  const normalizedUsage = normalizeAiUsage(usage);
  const estimatedAiCostUsd = estimateAiCostUsd(normalizedUsage);

  return {
    event: "proofttl_verification_cost_sample",
    phase: String(phase || "UNKNOWN"),
    verifier: String(verifier || "unknown"),
    result: result ? String(result) : null,
    status: status ? String(status) : null,
    source_chars: finiteNonNegative(sourceChars),
    raw_source_chars: finiteNonNegative(rawSourceChars),
    ai_usage: normalizedUsage,
    estimated_ai_cost_usd: estimatedAiCostUsd,
    pricing_model: SEMANTIC_MODEL_PRICING.model,
    pricing_checked_at: SEMANTIC_MODEL_PRICING.checked_at
  };
}

function finiteNonNegative(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) return null;
  return number;
}

function roundUsd(value) {
  return Math.round(value * 1e12) / 1e12;
}
