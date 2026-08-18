export const BENCHMARK_MODELS = Object.freeze({
  current70b: Object.freeze({
    id: "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
    jsonSchema: true,
    maxTokens: 300,
    retryMaxTokens: null,
    inputUsdPerMillionTokens: 0.293,
    outputUsdPerMillionTokens: 2.253,
    pricingCheckedAt: "2026-08-17",
    note: "Current production semantic verifier. Official Workers AI JSON Mode support is documented."
  }),
  qwen3: Object.freeze({
    id: "@cf/qwen/qwen3-30b-a3b-fp8",
    jsonSchema: false,
    maxTokens: 900,
    retryMaxTokens: 2000,
    inputUsdPerMillionTokens: 0.051,
    outputUsdPerMillionTokens: 0.34,
    pricingCheckedAt: "2026-08-17",
    note: "Lower-cost reasoning candidate. The benchmark starts at 900 output tokens and retries only explicitly length-truncated invalid outputs with 2000 tokens, counting both attempts in usage and cost."
  }),
  llama8bFast: Object.freeze({
    id: "@cf/meta/llama-3.1-8b-instruct-fast",
    jsonSchema: true,
    maxTokens: 300,
    retryMaxTokens: null,
    inputUsdPerMillionTokens: null,
    outputUsdPerMillionTokens: null,
    pricingCheckedAt: "2026-08-17",
    note: "Official JSON Mode support is documented. Exact unit pricing for this model alias was not surfaced in the pricing snapshot, so cost is intentionally left unknown."
  })
});
