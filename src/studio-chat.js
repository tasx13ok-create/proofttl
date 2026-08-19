import { consumeAssistantQuota } from "./assistant-quota.js";
import { assistantModelRuntime, assistantResponseProviderAvailable, runAssistantResponse } from "./assistant-model-router.js";

const MAX_MESSAGE_CHARS = 5000;
const MAX_HISTORY_MESSAGES = 8;
const MAX_HISTORY_CHARS = 2200;

export async function handleStudioChat(request, env) {
  if (request.method !== "POST") {
    return json({ error: "method_not_allowed", message: "Use POST with application/json." }, 405, { allow: "POST, OPTIONS" });
  }

  if (!assistantResponseProviderAvailable(env)) {
    return json({ error: "studio_model_unavailable", message: "The Studio coding model is not configured on this deployment." }, 503);
  }

  const contentType = request.headers.get("content-type") || "";
  if (!contentType.toLowerCase().includes("application/json")) {
    return json({ error: "json_content_type_required", message: "Send application/json." }, 415);
  }

  const limiter = env?.ASSISTANT_RATE_LIMITER;
  if (!limiter || typeof limiter.limit !== "function") {
    return json({ error: "studio_rate_limiter_unavailable", message: "Studio is not configured safely yet." }, 503);
  }

  const ip = (request.headers.get("cf-connecting-ip") || "anonymous").trim().slice(0, 80);
  const limited = await limiter.limit({ key: `studio:${ip}` });
  if (!limited?.success) {
    return json({ error: "studio_rate_limit_exceeded", message: "Too many Studio requests. Try again shortly." }, 429, { "retry-after": "60" });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "invalid_json", message: "Studio request body must be valid JSON." }, 400);
  }

  const message = clean(body?.message, MAX_MESSAGE_CHARS);
  if (!message) return json({ error: "message_required", message: "Enter a coding request." }, 400);

  const language = clean(body?.language, 40) || "auto";
  const editor = clean(body?.editor, 12000);
  const history = normalizeHistory(body?.history);
  const quota = await consumeAssistantQuota(request, env);
  if (!quota.allowed) {
    return json({ error: "assistant_free_limit_reached", message: "You reached today's ProofTTL AI limit.", quota }, 429, { "retry-after": String(quota.retry_after_seconds) });
  }

  const messages = [
    {
      role: "system",
      content: [
        "You are ProofTTL Studio, a practical coding assistant inside the ProofTTL developer workspace.",
        "Help with programming, debugging, refactoring, APIs, shells including PowerShell, architecture, tests, and developer tooling.",
        "Prefer concrete code and concise explanations. Preserve user constraints and existing code when supplied.",
        "Never claim code, commands, deployments, files, or shell operations were executed unless the surrounding system explicitly reports execution.",
        "The browser Studio terminal is not an arbitrary host shell. When asked to run commands, provide the command and explain whether it requires the user's machine or an isolated execution sandbox.",
        "Do not request or expose secrets unnecessarily. Use placeholders for API keys and credentials.",
        `Current requested language/runtime hint: ${language}.`
      ].join(" ")
    },
    ...(editor ? [{ role: "system", content: `Current editor contents follow. Treat them as user-provided working code.\n---EDITOR---\n${editor}\n---END EDITOR---` }] : []),
    ...history,
    { role: "user", content: message }
  ];

  try {
    const completion = await runAssistantResponse(env, {
      messages,
      max_tokens: 700,
      temperature: 0.25
    });
    const response = extractText(completion).slice(0, 6000);
    if (!response) return json({ error: "studio_empty_response", message: "Studio did not return a usable response.", quota }, 503);

    const runtime = assistantModelRuntime(env);
    return json({
      response,
      quota,
      runtime: {
        provider: runtime.provider,
        model: runtime.response_model,
        execution: "advice_only_no_host_shell"
      }
    });
  } catch (error) {
    console.warn(JSON.stringify({ event: "studio_chat_failed", error: error?.name || error?.message || "Error" }));
    return json({ error: "studio_capacity_unavailable", message: "Studio model capacity is unavailable right now.", quota }, 503);
  }
}

function normalizeHistory(value) {
  if (!Array.isArray(value)) return [];
  return value.slice(-MAX_HISTORY_MESSAGES).map((item) => {
    const role = item?.role === "assistant" ? "assistant" : item?.role === "user" ? "user" : null;
    const content = clean(item?.content, MAX_HISTORY_CHARS);
    return role && content ? { role, content } : null;
  }).filter(Boolean);
}

function extractText(value) {
  if (typeof value === "string") return value.trim();
  if (typeof value?.response === "string") return value.response.trim();
  if (typeof value?.choices?.[0]?.message?.content === "string") return value.choices[0].message.content.trim();
  return "";
}

function clean(value, max) {
  return typeof value === "string" ? value.replace(/\u0000/g, "").trim().slice(0, max) : "";
}

function json(body, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...extraHeaders }
  });
}
