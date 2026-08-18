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

const PRODUCT_KNOWLEDGE = [
  {
    patterns: [/\bwhat(?:'s| is) proofttl\b/i, /\bwhat does proofttl do\b/i, /\bexplain proofttl\b/i, /^proofttl\??$/i],
    response: "ProofTTL is a verification system for facts that can change over time. It turns a precise claim plus a source into a source-backed Fact Lease with a verdict, evidence, fingerprint, confidence, expiry, and ongoing monitoring. Instead of treating a fact as permanently true, ProofTTL can re-check the source and revoke the lease if the evidence no longer supports the original verdict."
  },
  {
    patterns: [/\bwhat(?:'s| is) (?:a )?fact lease\b/i, /\bexplain (?:a )?fact lease\b/i, /\bhow do fact leases work\b/i],
    response: "A Fact Lease is a time-bounded verification object for one claim. It records the claim, source, evidence, verdict, source fingerprint, confidence, issue time, expiry, and current lease state. While active, ProofTTL can monitor the source and revoke the lease if the original verdict can no longer be maintained."
  },
  {
    patterns: [/\bwhat (?:are|do) (?:the )?(?:verdicts|statuses)\b/i, /\bsupported contradicted unknown\b/i],
    response: "ProofTTL verdicts are SUPPORTED, CONTRADICTED, and UNKNOWN. SUPPORTED means the source supports the claim, CONTRADICTED means the source conflicts with it, and UNKNOWN means the available source does not justify either conclusion. Lease states are separate: ACTIVE, REVOKED, or EXPIRED."
  },
  {
    patterns: [/\bhow (?:does|do) (?:the )?monitor(?:ing)? work\b/i, /\bwhat happens (?:if|when) (?:a |the )?source changes\b/i, /\bautomatic monitoring\b/i],
    response: "ProofTTL automatically re-checks active Fact Leases on a schedule. If the source is unchanged, the lease can remain active. If the source changes, ProofTTL re-verifies the claim; when the original verdict can no longer be maintained before expiry, the lease can be REVOKED and the change is recorded in its history."
  }
];

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

  const productAnswer = matchProductKnowledge(message);
  if (productAnswer) {
    const quota = await getAssistantQuota(request, env);
    return jsonResponse({
      message,
      response: productAnswer,
      action: null,
      quota,
      context: {
        history_messages_used: history.length,
        max_history_messages: MAX_HISTORY_MESSAGES
      },
      inference: {
        response_model: null,
        deterministic_route: true,
        knowledge_route: true
      }
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
    const completion = await env.AI.run(ASSISTANT_MODELS.response, {
      messages: [
        { role: "system", content: assistantSystemPrompt() },
        ...history,
        { role: "user", content: message }
      ],
      max_tokens: 180,
      temperature: 0.2
    });

    const response = cleanResponse(extractCompletionText(completion));
    return jsonResponse({
      message,
      response: response || "I can help with ProofTTL, Fact Leases, the API, x402, monitoring, payments, and product navigation.",
      action: null,
      quota,
      context: {
        history_messages_used: history.length,
        max_history_messages: MAX_HISTORY_MESSAGES
      },
      inference: {
        response_model: ASSISTANT_MODELS.response,
        deterministic_route: false
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

function matchProductKnowledge(message) {
  for (const item of PRODUCT_KNOWLEDGE) {
    if (item.patterns.some((pattern) => pattern.test(message))) return item.response;
  }
  return null;
}

function extractCompletionText(completion) {
  if (typeof completion?.response === "string") return completion.response;
  if (typeof completion?.result?.response === "string") return completion.result.response;
  if (typeof completion?.text === "string") return completion.text;
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
