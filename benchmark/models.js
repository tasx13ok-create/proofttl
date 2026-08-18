export const BENCHMARK_MODELS = Object.freeze({
  current70b: Object.freeze({
    id: "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
    jsonSchema: true,
    inputUsdPerMillionTokens: 0.293,
    outputUsdPerMillionTokens: 2.253,
    pricingCheckedAt: "2026-08-17",
    note: "Current production semantic verifier. Official Workers AI JSON Mode support is documented."
  }),
  qwen3: Object.freeze({
    id: "@cf/qwen/qwen3-30b-a3b-fp8",
    jsonSchema: false,
    inputUsdPerMillionTokens: 0.051,
    outputUsdPerMillionTokens: 0.34,
    pricingCheckedAt: "2026-08-17",
    note: "Lower-cost candidate. Cloudflare does not currently list this model as JSON Mode-supported, so the benchmark requests JSON text and validates it locally."
  }),
  llama8bFast: Object.freeze({
    id: "@cf/meta/llama-3.1-8b-instruct-fast",
    jsonSchema: true,
    inputUsdPerMillionTokens: null,
    outputUsdPerMillionTokens: null,
    pricingCheckedAt: "2026-08-17",
    note: "Official JSON Mode support is documented. Exact unit pricing for this model alias was not surfaced in the pricing snapshot, so cost is intentionally left unknown."
  })
});
