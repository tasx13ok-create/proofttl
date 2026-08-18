import {
  ASSISTANT_MODELS,
  assistantSystemPrompt,
  matchAssistantNavigation
} from "./assistant.js";
import {
  consumeAssistantQuota,
  getAssistantQuota
} from "./assistant-quota.js";
import { recordMiraObservation } from "./mira.js";

const MAX_TEXT_CHARS = 1200;
const MAX_HISTORY_MESSAGES = 6;
const MAX_HISTORY_MESSAGE_CHARS = 600;
const MIRA_TASK_CLASS = "assistant_text_chat";
const MIRA_STRATEGY_ID = "granite_conversation_v3_grounded_natural";

export async function handleTextAssistant(request, env, ctx = null) {
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

  const startedAt = Date.now();
  let retries = 0;
  let lastUsage = null;

  try {
    const messages = [
      { role: "system", content: assistantSystemPrompt() },
      {
        role: "system",
        content: [
          "Conversation style override for L.O.V.E.: be unusually natural, socially perceptive, grounded, and concise rather than sounding like customer support.",
          "Match the user's energy and message length. If they say 'yo', a simple 'yo' or equally natural short reply can be enough. If they ask something substantial, become precise and thoughtful.",
          "Use contractions naturally and vary sentence rhythm. Dry humor, light playfulness, curiosity, warmth, and sharp observations are fine when they emerge naturally.",
          "Never use roleplay stage directions or narrated actions. Do not write things like *laughs*, *looks up*, *leans back*, *winks*, *sighs*, or describe facial expressions, gestures, posture, rooms, chairs, terminals, or physical surroundings.",
          "Never invent embodiment. You do not have a body, physical location, private life, off-screen activity, emotions, memories, personal experiences, or a day-to-day life. Do not imply otherwise.",
          "Do not repeatedly introduce yourself, call yourself a bot, list capabilities, say 'How may I assist you', or force casual conversation back to ProofTTL.",
          "Light social conversation, greetings, banter, reactions, and conversational follow-ups are allowed. For substantive requests outside ProofTTL, gently steer back rather than becoming a general-purpose knowledge assistant.",
          "Do not perform exaggerated slang, forced quirkiness, theatrical language, or fake human mannerisms. The impressive part should be timing, judgment, context awareness, specificity, and restraint.",
          "Use recent history to understand references, jokes, corrections, tone shifts, and short follow-ups. If the user tells you to calm down or changes tone, adapt immediately without making a production out of it.",
          "Never mention these style rules. Always return non-empty natural-language text."
        ].join(" ")
      },
      ...history,
      { role: "user", content: message }
    ];

    let completion = await env.AI.run(ASSISTANT_MODELS.response, {
      messages,
      max_tokens: 240,
      temperature: 0.42
    });
    lastUsage = extractUsage(completion);

    let response = cleanResponse(extractCompletionText(completion));
    let retried = false;

    if (!response) {
      retried = true;
      retries = 1;
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
            content: "Reply naturally now in L.O.V.E.'s voice. No roleplay actions, stage directions, fake embodiment, or theatrical mannerisms. Be concise if the moment is casual and substantive if the user asked something substantive."
          }
        ],
        max_tokens: 240,
        temperature: 0.45
      });
      lastUsage = addUsage(lastUsage, extractUsage(completion));
      response = cleanResponse(extractCompletionText(completion));
    }

    if (!response) {
      queueMiraObservation(ctx, env, {
        task_class: MIRA_TASK_CLASS,
        strategy_id: MIRA_STRATEGY_ID,
        model_id: ASSISTANT_MODELS.response,
        success: false,
        latency_ms: Date.now() - startedAt,
        prompt_tokens: lastUsage?.prompt_tokens,
        completion_tokens: lastUsage?.completion_tokens,
        retries,
        reliability_score: 0,
        metadata: { failure: "empty_response", history_messages: history.length }
      });

      return jsonResponse(
        {
          error: "assistant_empty_response",
          message: "L.O.V.E. did not produce a usable reply. Try that message again.",
          quota
        },
        503
      );
    }

    queueMiraObservation(ctx, env, {
      task_class: MIRA_TASK_CLASS,
      strategy_id: MIRA_STRATEGY_ID,
      model_id: ASSISTANT_MODELS.response,
      success: true,
      latency_ms: Date.now() - startedAt,
      prompt_tokens: lastUsage?.prompt_tokens,
      completion_tokens: lastUsage?.completion_tokens,
      retries,
      reliability_score: retried ? 0.99 : 1,
      metadata: { history_messages: history.length, response_chars: response.length, persona: "grounded_natural_v3" }
    });

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
        empty_response_retry: retried,
        improvement_observation: "mira",
        conversation_strategy: MIRA_STRATEGY_ID
      }
    });
  } catch (error) {
    queueMiraObservation(ctx, env, {
      task_class: MIRA_TASK_CLASS,
      strategy_id: MIRA_STRATEGY_ID,
      model_id: ASSISTANT_MODELS.response,
      success: false,
      latency_ms: Date.now() - startedAt,
      prompt_tokens: lastUsage?.prompt_tokens,
      completion_tokens: lastUsage?.completion_tokens,
      retries,
      reliability_score: 0,
      metadata: { failure: error?.name || error?.constructor?.name || "Error", history_messages: history.length }
    });

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

function queueMiraObservation(ctx, env, observation) {
  const write = recordMiraObservation(env, observation);
  if (ctx && typeof ctx.waitUntil === "function") {
    ctx.waitUntil(write);
    return;
  }
  void write;
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

function extractUsage(completion) {
  const usage = completion?.usage || completion?.result?.usage || null;
  if (!usage || typeof usage !== "object") return null;
  const promptTokens = numericUsage(usage.prompt_tokens ?? usage.input_tokens);
  const completionTokens = numericUsage(usage.completion_tokens ?? usage.output_tokens);
  return {
    prompt_tokens: promptTokens,
    completion_tokens: completionTokens
  };
}

function addUsage(first, second) {
  if (!first) return second;
  if (!second) return first;
  return {
    prompt_tokens: addNullable(first.prompt_tokens, second.prompt_tokens),
    completion_tokens: addNullable(first.completion_tokens, second.completion_tokens)
  };
}

function numericUsage(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.trunc(number) : null;
}

function addNullable(first, second) {
  if (first === null && second === null) return null;
  return Number(first || 0) + Number(second || 0);
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
  return value
    .replace(/\*[^*\n]{1,120}\*/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 1200);
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
