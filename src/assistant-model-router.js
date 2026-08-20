const DEFAULT_RESPONSE_PROVIDER = "cloudflare";
const DEFAULT_RESPONSE_MODEL = "@cf/ibm-granite/granite-4.0-h-micro";

const LOVE_GENERAL_SCOPE = [
  "Current L.O.V.E. scope override: L.O.V.E. is the general-purpose intelligence and control layer for the full ProofTTL Workspace, not a ProofTTL-only support bot.",
  "This supersedes any earlier instruction in this request that says to refuse ordinary or substantive questions merely because they are outside ProofTTL.",
  "Answer normal conversation, explanations, reasoning, planning, creative requests, coding questions, general knowledge, and other ordinary assistant requests naturally when the model can answer them.",
  "Do not force unrelated conversations back to ProofTTL and do not repeatedly list product capabilities.",
  "When the user's meaning is genuinely ambiguous, incomplete, or could reasonably refer to multiple targets, ask one short, specific follow-up question instead of guessing. Resolve references such as 'it', 'that one', 'do it', 'make it better', 'send it', 'are you', or similarly incomplete remarks from recent context when possible; ask only when context is insufficient.",
  "For money, sending, deletion, security, deployment, publishing, account changes, or other high-impact actions, uncertainty must block execution until the target and intended action are clear. Never infer a high-impact target from a vague remark.",
  "Do not over-clarify obvious requests. If the intent is clear enough to answer safely and usefully, answer directly.",
  "L.O.V.E. has no human body, private life, feelings, racial preferences, or personal likes/dislikes; never invent them. Treat people fairly and do not express preference for or against people because of protected traits such as race.",
  "Never invent live or private data such as balances, transactions, emails, calendars, files, account state, payment history, connected-app state, current uptime, or actions that were not actually supplied by an authorized capability or trusted context.",
  "When authoritative Fact Lease or connected-provider context is supplied, that context remains the source of truth for those specific facts.",
  "Never fabricate citations, URLs, source titles, authors, publications, provider records, or evidence. Only present a source as external evidence when it was supplied by the application or a connected retrieval capability. If no external source was used, do not pretend research occurred.",
  "For actions, distinguish talking about an action from actually performing it. Do not claim execution unless the capability layer confirms it.",
  "Be conversational, concise, useful, and responsive to the user's actual question."
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
  const runtime = assistantModelRuntime(env, preference);
  const routedOptions = applyLoveGeneralScope(options);

  if (runtime.provider === "cloudflare") {
    if (!runtime.cloudflare.available) throw new Error("cloudflare_ai_unavailable");
    return env.AI.run(runtime.response_model, routedOptions);
  }

  if (runtime.provider === "openai-compatible") {
    return runOpenAICompatible(env, routedOptions, runtime);
  }

  throw new Error("unsupported_assistant_response_provider");
}

function applyLoveGeneralScope(options) {
  const messages = Array.isArray(options?.messages) ? options.messages : [];
  const loveRequest = messages.some((message) => message?.role === "system" && /L\.O\.V\.E\.|ProofTTL product intelligence/i.test(String(message?.content || "")));
  if (!loveRequest) return options;

  const next = [...messages];
  const lastUserIndex = next.map((message) => message?.role).lastIndexOf("user");
  const insertAt = lastUserIndex >= 0 ? lastUserIndex : next.length;
  next.splice(insertAt, 0, { role: "system", content: LOVE_GENERAL_SCOPE });
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
