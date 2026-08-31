const DEFAULT_RESPONSE_PROVIDER = "cloudflare";
const DEFAULT_RESPONSE_MODEL = "@cf/ibm-granite/granite-4.0-h-micro";

const PROOFTTL_ASSISTANT_SCOPE = [
  "ProofTTL assistant scope is product-only.",
  "Only assist with ProofTTL, the $1,500 Fact Audit, claim verification, evidence and source quality, audit status, account access, payment and fulfillment, Fact Leases, monitoring, and navigation inside ProofTTL.",
  "For unrelated requests, do not answer the substantive request. Briefly state that the assistant is limited to ProofTTL and offer the closest relevant ProofTTL action.",
  "The only paid audit offer is the $1,500 Fact Audit. Do not describe retired prices, stress-test offers, upgrade credits, or legacy general-purpose Workspace capabilities.",
  "Never invent live or private data such as balances, transactions, emails, calendars, files, account state, payment history, connected-app state, current uptime, audit results, evidence, or actions that were not supplied by an authorized capability or trusted context.",
  "When authoritative Fact Lease, audit, or connected-provider context is supplied, that context is the source of truth for those specific facts.",
  "Never fabricate citations, URLs, source titles, authors, publications, provider records, evidence, image URLs, image captions, thumbnails, or visual-search results.",
  "For actions, distinguish discussing an action from actually performing it. Do not claim execution unless the capability layer confirms it.",
  "For payment, publishing, account, security, or other high-impact actions, uncertainty must block execution until the target and intended action are clear.",
  "Be concise, specific, and buyer-focused."
].join(" ");

export function assistantModelCatalog(env) {
  const cloudflareDefault = clean(env?.PROOFTTL_RESPONSE_MODEL || DEFAULT_RESPONSE_MODEL);
  const cloudflareModels = unique([cloudflareDefault, ...csv(env?.PROOFTTL_CLOUDFLARE_MODEL_CATALOG)]);
  const externalModel = clean(env?.PROOFTTL_EXTERNAL_AI_MODEL);
  const externalConfigured = Boolean(
    clean(env?.PROOFTTL_EXTERNAL_AI_BASE_URL) &&
    externalModel &&
    clean(env?.PROOFTTL_EXTERNAL_AI_API_KEY) &&
    validHttpsBase(env?.PROOFTTL_EXTERNAL_AI_BASE_URL)
  );

  return {
    cloudflare: cloudflareModels.map((model) => ({ provider: "cloudflare", model })),
    openai_compatible: externalConfigured ? [{ provider: "openai-compatible", model: externalModel }] : []
  };
}

export function assistantModelRuntime(env, preference = null) {
  const route = resolveRoute(env, preference);
  const cloudflareModel = route.provider === "cloudflare" ? route.model : clean(env?.PROOFTTL_RESPONSE_MODEL || DEFAULT_RESPONSE_MODEL);
  const externalBaseUrl = clean(env?.PROOFTTL_EXTERNAL_AI_BASE_URL);
  const externalModel = clean(env?.PROOFTTL_EXTERNAL_AI_MODEL);
  const externalKeyConfigured = Boolean(clean(env?.PROOFTTL_EXTERNAL_AI_API_KEY));

  return {
    provider: route.provider,
    response_model: route.model,
    preference_applied: route.preference_applied,
    cloudflare: {
      available: Boolean(env?.AI && typeof env.AI.run === "function"),
      model: cloudflareModel,
      catalog: assistantModelCatalog(env).cloudflare.map((item) => item.model)
    },
    openai_compatible: {
      configured: Boolean(externalBaseUrl && externalModel && externalKeyConfigured && validHttpsBase(externalBaseUrl)),
      base_url_configured: Boolean(externalBaseUrl),
      model: externalModel || null,
      api_key_configured: externalKeyConfigured
    }
  };
}

export function assistantResponseProviderAvailable(env, preference = null) {
  const runtime = assistantModelRuntime(env, preference);
  if (runtime.provider === "cloudflare") return runtime.cloudflare.available;
  if (runtime.provider === "openai-compatible") return runtime.openai_compatible.configured;
  return false;
}

export async function runAssistantResponse(env, options, preference = null) {
  const effectivePreference = preference || foundryModelPreference(env, options);
  const runtime = assistantModelRuntime(env, effectivePreference);
  const routedOptions = applyProofTTLScope(options);

  if (runtime.provider === "cloudflare") {
    if (!runtime.cloudflare.available) throw new Error("cloudflare_ai_unavailable");
    return env.AI.run(runtime.response_model, routedOptions);
  }

  if (runtime.provider === "openai-compatible") {
    return runOpenAICompatible(env, routedOptions, runtime);
  }

  throw new Error("unsupported_assistant_response_provider");
}

function foundryModelPreference(env, options) {
  const messages = Array.isArray(options?.messages) ? options.messages : [];
  const foundryRequest = messages.some((message) => message?.role === "system" && /ProofTTL Foundry/i.test(String(message?.content || "")));
  if (!foundryRequest) return null;

  const catalog = assistantModelCatalog(env);
  const defaultModel = clean(env?.PROOFTTL_RESPONSE_MODEL || DEFAULT_RESPONSE_MODEL);
  const council = [
    ...catalog.openai_compatible,
    ...catalog.cloudflare.filter((item) => item.model !== defaultModel)
  ];
  if (!council.length) return null;

  const userPrompt = [...messages].reverse().find((message) => message?.role === "user")?.content || "";
  let roleIndex = 0;
  if (/hostile investment committee|JSON schema:\s*\{\"verdicts\"/i.test(String(userPrompt))) roleIndex = 1;
  else if (/CURRENT LEADERS=|replace the current leaders|challenger businesses/i.test(String(userPrompt))) roleIndex = 2;
  const route = council[roleIndex % council.length];
  return route ? { preferred_ai_provider: route.provider, preferred_ai_model: route.model } : null;
}

function applyProofTTLScope(options) {
  const messages = Array.isArray(options?.messages) ? options.messages : [];
  const assistantRequest = messages.some((message) => message?.role === "system" && /L\.O\.V\.E\.|ProofTTL product assistant|ProofTTL product intelligence/i.test(String(message?.content || "")));
  if (!assistantRequest) return options;

  const next = [...messages];
  const lastUserIndex = next.map((message) => message?.role).lastIndexOf("user");
  const insertAt = lastUserIndex >= 0 ? lastUserIndex : next.length;
  next.splice(insertAt, 0, { role: "system", content: PROOFTTL_ASSISTANT_SCOPE });
  return { ...options, messages: next };
}

function resolveRoute(env, preference) {
  const defaultProvider = clean(env?.PROOFTTL_RESPONSE_PROVIDER || DEFAULT_RESPONSE_PROVIDER).toLowerCase();
  const defaultModel = defaultProvider === "openai-compatible"
    ? clean(env?.PROOFTTL_EXTERNAL_AI_MODEL)
    : clean(env?.PROOFTTL_RESPONSE_MODEL || DEFAULT_RESPONSE_MODEL);

  const requestedProvider = clean(preference?.preferred_ai_provider).toLowerCase();
  const requestedModel = clean(preference?.preferred_ai_model);
  if (!requestedProvider || !requestedModel) {
    return { provider: defaultProvider, model: defaultModel, preference_applied: false };
  }

  const catalog = assistantModelCatalog(env);
  const allowed = requestedProvider === "cloudflare"
    ? catalog.cloudflare.some((item) => item.model === requestedModel)
    : requestedProvider === "openai-compatible"
      ? catalog.openai_compatible.some((item) => item.model === requestedModel)
      : false;

  if (!allowed) return { provider: defaultProvider, model: defaultModel, preference_applied: false };
  return { provider: requestedProvider, model: requestedModel, preference_applied: true };
}

async function runOpenAICompatible(env, options, runtime) {
  const rawBase = clean(env?.PROOFTTL_EXTERNAL_AI_BASE_URL);
  const apiKey = clean(env?.PROOFTTL_EXTERNAL_AI_API_KEY);
  const model = runtime.response_model;
  if (!runtime.openai_compatible.configured || !validHttpsBase(rawBase) || model !== clean(env?.PROOFTTL_EXTERNAL_AI_MODEL)) {
    throw new Error("external_ai_not_configured_safely");
  }

  const base = rawBase.replace(/\/$/, "");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), positiveInt(env?.PROOFTTL_EXTERNAL_AI_TIMEOUT_MS, 20000));

  try {
    const response = await fetch(`${base}/chat/completions`, {
      method: "POST",
      headers: { "authorization": `Bearer ${apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({
        model,
        messages: Array.isArray(options?.messages) ? options.messages : [],
        max_tokens: positiveInt(options?.max_tokens, 240),
        temperature: finiteNumber(options?.temperature, 0.25)
      }),
      signal: controller.signal
    });

    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error("external_ai_request_failed");
      error.status = response.status;
      throw error;
    }

    const text = typeof body?.choices?.[0]?.message?.content === "string" ? body.choices[0].message.content : "";
    return { response: text, usage: body?.usage || null, provider: "openai-compatible", model };
  } finally {
    clearTimeout(timeout);
  }
}

function csv(value) { return String(value || "").split(",").map((item) => item.trim()).filter(Boolean); }
function unique(values) { return [...new Set(values.filter(Boolean))]; }
function validHttpsBase(value) {
  try { const parsed = new URL(String(value || "")); return parsed.protocol === "https:" && !parsed.username && !parsed.password; }
  catch { return false; }
}
function positiveInt(value, fallback) { const parsed = Number(value); return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback; }
function finiteNumber(value, fallback) { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : fallback; }
function clean(value) { return typeof value === "string" ? value.trim() : ""; }

export const DEFAULT_ASSISTANT_RESPONSE_MODEL = DEFAULT_RESPONSE_MODEL;