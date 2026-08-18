import {
  ASSISTANT_MODELS,
  assistantSystemPrompt,
  matchAssistantNavigation
} from "./assistant.js";
import {
  consumeAssistantQuota,
  getAssistantQuota
} from "./assistant-quota.js";

const MAX_TEXT_CHARS = 1200;
const MAX_HISTORY_MESSAGES = 6;
const MAX_HISTORY_MESSAGE_CHARS = 600;

export async function handleTextAssistant(request, env) {
  if (request.method !== "POST") {
    return jsonResponse(
      { error: "method_not_allowed", message: "Use POST with application/json and a message field." },
      405,
      { allow: "POST, OPTIONS" }
    );
  }

  if (!env?.AI || typeof env.AI.run !== "function") {
    return jsonResponse(
      { error: "assistant_unavailable", message: "ProofTTL assistance is not available right now." },
      503
    );
  }

  const contentType = request.headers.get("content-type") || "";
  if (!contentType.toLowerCase().includes("application/json")) {
    return jsonResponse(
      { error: "json_content_type_required", message: "Send application/json with a message field." },
      415
    );
  }

  const limiter = env.ASSISTANT_RATE_LIMITER;
  if (!limiter || typeof limiter.limit !== "function") {
    return jsonResponse(
      { error: "assistant_rate_limiter_unavailable", message: "ProofTTL assistance is not configured safely yet." },
      503
    );
  }

  const { success } = await limiter.limit({ key: assistantRateLimitKey(request) });
  if (!success) {
    return jsonResponse(
      { error: "assistant_rate_limit_exceeded", message: "Too many assistant requests. Try again shortly." },
      429,
      { "retry-after": "60" }
    );
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse(
      { error: "invalid_json", message: "The assistant request body must be valid JSON." },
      400
    );
  }

  const message = normalizeMessage(body?.message);
  if (!message) {
    return jsonResponse({ error: "message_required", message: "Enter a ProofTTL question." }, 400);
  }

  const history = normalizeHistory(body?.history);
  const action = matchAssistantNavigation(message);
  if (action) {
    const quota = await getAssistantQuota(request, env);
    return jsonResponse({
      message,
      response: `Opening ${action.label}.`,
      action: { type: "navigate", route: action.route, section: action.section },
      quota,
      inference: { response_model: null, deterministic_route: true }
    });
  }

  const quota = await consumeAssistantQuota(request, env);
  if (!quota.allowed) {
    return jsonResponse(
      {
        error: "assistant_free_limit_reached",
        message: "You reached today's free ProofTTL AI limit. Monthly member access will unlock a larger assistant allowance when plans launch.",
        quota
      },
      429,
      { "retry-after": String(quota.retry_after_seconds) }
    );
  }

  try {
    const messages = [
      { role: "system", content: assistantSystemPrompt() },
      ...history,
      { role: "user", content: message }
    ];

    let completion = await env.AI.run(ASSISTANT_MODELS.response, {
      messages,
      max_tokens: 220,
      temperature: 0.35
    });

    let response = cleanResponse(extractCompletionText(completion));
    let retried = false;

    if (!response) {
      retried = true;
      console.warn(JSON.stringify({
        event: "assistant_text_empty_completion",
        model: ASSISTANT_MODELS.response,
        completion_keys: completion && typeof completion === "object" ? Object.keys(completion).slice(0, 12) : []
      }));

      completion = await env.AI.run(ASSISTANT_MODELS.response, {
        messages: [
          ...messages,
          {
            role: "system",
            content: "Return a short natural-language reply now. Do not return an empty response. Continue the conversation naturally while staying within ProofTTL product scope."
          }
        ],
        max_tokens: 220,
        temperature: 0.4
      });
      response = cleanResponse(extractCompletionText(completion));
    }

    if (!response) {
      return jsonResponse(
        {
          error: "assistant_empty_response",
          message: "L.O.V.E. did not produce a usable reply. Try that message again.",
          quota
        },
        503
      );
    }

    return jsonResponse({
      message,
      response,
      action: null,
      quota,
      context: {
        history_messages_used: history.length,
        max_history_messages: MAX_HISTORY_MESSAGES
      },
      inference: {
        response_model: ASSISTANT_MODELS.response,
        deterministic_route: false,
        empty_response_retry: retried
      }
    });
  } catch (error) {
    console.warn(JSON.stringify({
      event: "assistant_text_response_failed",
      error: error?.name || error?.constructor?.name || "Error"
    }));

    return jsonResponse(
      {
        error: "assistant_capacity_unavailable",
        message: "ProofTTL assistance has reached its current free AI capacity or the model is temporarily unavailable. Try again later.",
        quota
      },
      503
    );
  }
}

function extractCompletionText(completion) {
  if (typeof completion === "string") return completion;
  if (typeof completion?.response === "string") return completion.response;
  if (typeof completion?.result?.response === "string") return completion.result.response;
  if (typeof completion?.text === "string") return completion.text;
  if (typeof completion?.output_text === "string") return completion.output_text;
  if (typeof completion?.message?.content === "string") return completion.message.content;
  if (typeof completion?.choices?.[0]?.message?.content === "string") return completion.choices[0].message.content;
  if (typeof completion?.choices?.[0]?.text === "string") return completion.choices[0].text;
  return "";
}

function normalizeHistory(value) {
  if (!Array.isArray(value)) return [];
  return value
    .slice(-MAX_HISTORY_MESSAGES)
    .map((item) => {
      const role = item?.role === "assistant" ? "assistant" : item?.role === "user" ? "user" : null;
      const content = typeof item?.content === "string"
        ? item.content.replace(/\s+/g, " ").trim().slice(0, MAX_HISTORY_MESSAGE_CHARS)
        : "";
      return role && content ? { role, content } : null;
    })
    .filter(Boolean);
}

function normalizeMessage(value) {
  if (typeof value !== "string") return "";
  return value.replace(/\s+/g, " ").trim().slice(0, MAX_TEXT_CHARS);
}

function cleanResponse(value) {
  if (typeof value !== "string") return "";
  return value.replace(/\s+/g, " ").trim().slice(0, 1200);
}

function assistantRateLimitKey(request) {
  const ip = (request.headers.get("cf-connecting-ip") || "anonymous").trim();
  return `assistant:${ip.slice(0, 80)}`;
}

function jsonResponse(body, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...extraHeaders
    }
  });
}
