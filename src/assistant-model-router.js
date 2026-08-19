const DEFAULT_RESPONSE_PROVIDER = "cloudflare";
const DEFAULT_RESPONSE_MODEL = "@cf/ibm-granite/granite-4.0-h-micro";

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
  const runtime = assistantModelRuntime(env, preference);

  if (runtime.provider === "cloudflare") {
    if (!runtime.cloudflare.available) throw new Error("cloudflare_ai_unavailable");
    return env.AI.run(runtime.response_model, options);
  }

  if (runtime.provider === "openai-compatible") {
    return runOpenAICompatible(env, options, runtime);
  }

  throw new Error("unsupported_assistant_response_provider");
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
        temperature: finiteNumber(options?.temperature, 0.42)
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
