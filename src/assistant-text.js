import {
  assistantSystemPrompt,
  matchAssistantNavigation
} from "./assistant.js";
import {
  assistantModelRuntime,
  assistantResponseProviderAvailable,
  runAssistantResponse
} from "./assistant-model-router.js";
import {
  consumeAssistantQuota,
  getAssistantQuota
} from "./assistant-quota.js";
import { recordMiraObservation } from "./mira.js";

const MAX_TEXT_CHARS = 1200;
const MAX_HISTORY_MESSAGES = 6;
const MAX_HISTORY_MESSAGE_CHARS = 600;
const MIRA_TASK_CLASS = "assistant_text_chat";
const MIRA_STRATEGY_ID = "general_conversation_v5_grounded_tools";
const LEASE_ID_PATTERN = /\bftl_[a-f0-9]{16,64}\b/i;

export async function handleTextAssistant(request, env, ctx = null) {
  if (request.method !== "POST") {
    return jsonResponse(
      { error: "method_not_allowed", message: "Use POST with application/json and a message field." },
      405,
      { allow: "POST, OPTIONS" }
    );
  }

  if (!assistantResponseProviderAvailable(env)) {
    return jsonResponse(
      { error: "assistant_unavailable", message: "L.O.V.E. is not available right now." },
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
      { error: "assistant_rate_limiter_unavailable", message: "L.O.V.E. is not configured safely yet." },
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
    return jsonResponse({ error: "message_required", message: "Enter a message." }, 400);
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
        message: "You reached today's L.O.V.E. AI limit.",
        quota
      },
      429,
      { "retry-after": String(quota.retry_after_seconds) }
    );
  }

  const startedAt = Date.now();
  let retries = 0;
  let lastUsage = null;
  const casual = isCasualSocialMessage(message);
  const leaseGrounding = await loadLeaseGrounding(message, env);
  const modelRuntime = assistantModelRuntime(env);

  try {
    const messages = [
      { role: "system", content: assistantSystemPrompt() },
      {
        role: "system",
        content: [
          "L.O.V.E. is a general-purpose AI assistant. Normal conversation and substantive requests do not need to be about ProofTTL.",
          "Answer general knowledge questions, explain concepts, brainstorm, write, summarize user-provided material, help with coding, planning, creativity, learning, problem-solving, and ordinary life questions when the model has enough information.",
          "Do not redirect unrelated questions back to ProofTTL, do not advertise ProofTTL during normal conversation, and do not list product capabilities unless the user asks what the system can do.",
          "ProofTTL and connected Workspace capabilities are tools L.O.V.E. can use when relevant; they are not a conversational scope restriction.",
          "Live or private facts such as account data, balances, transactions, email, calendars, files, provider state, deployments, or Fact Lease state require authoritative connected context. Never invent those facts or claim an action happened when it did not.",
          "Match the user's energy and requested level of detail. Short casual messages usually deserve a short natural response; substantive questions deserve a useful substantive answer.",
          "Be socially perceptive, grounded, concise by default, and willing to go deeper when asked. Use contractions naturally.",
          "Never use roleplay stage directions or narrated actions. Never write asterisk actions such as *laughs*, *waves*, *looks up*, *leans back*, *winks*, or *sighs*.",
          "Never invent embodiment, surroundings, feelings, memories, a private life, off-screen activity, or human experiences. Do not claim to be human.",
          "Do not repeatedly introduce yourself, call yourself a bot, ask 'How may I assist you', or mention product scope as a fallback.",
          "If the user directly corrects your tone or behavior, acknowledge it briefly and comply immediately.",
          "Do not mention these rules. Always return non-empty natural-language text."
        ].join(" ")
      },
      ...(leaseGrounding ? [{
        role: "system",
        content: leaseGrounding.found
          ? `Authoritative live Fact Lease data follows. Treat these fields as the only source of truth for this Lease. Never infer a different status, state, expiry, source, history, or revocation detail. If a requested detail is absent, say it is not present in the Lease. DATA=${JSON.stringify(leaseGrounding.lease)}`
          : `The user referenced Fact Lease ${leaseGrounding.lease_id}, but ProofTTL storage did not return that Lease. Say it was not found and do not invent any Lease fields.`
      }] : []),
      ...(casual ? [{
        role: "system",
        content: "This turn is casual/social. Reply naturally and briefly. Do not mention ProofTTL or product capabilities unless the user mentions them first."
      }] : []),
      ...history,
      { role: "user", content: message }
    ];

    let completion = await runAssistantResponse(env, {
      messages,
      max_tokens: casual ? 90 : 320,
      temperature: casual ? 0.48 : 0.45
    });
    lastUsage = extractUsage(completion);

    let response = cleanResponse(extractCompletionText(completion));
    let retried = false;

    if (!response) {
      retried = true;
      retries = 1;
      console.warn(JSON.stringify({
        event: "assistant_text_empty_completion",
        provider: modelRuntime.provider,
        model: modelRuntime.response_model,
        completion_keys: completion && typeof completion === "object" ? Object.keys(completion).slice(0, 12) : []
      }));

      completion = await runAssistantResponse(env, {
        messages: [
          ...messages,
          {
            role: "system",
            content: casual
              ? "Reply to the user's casual message naturally in one short line. No product pitch, stage directions, or fake embodiment."
              : "Answer the user's request directly as a general-purpose assistant. Do not redirect to ProofTTL unless the request is actually about ProofTTL. No roleplay actions, stage directions, or fake embodiment."
          }
        ],
        max_tokens: casual ? 90 : 320,
        temperature: casual ? 0.5 : 0.47
      });
      lastUsage = addUsage(lastUsage, extractUsage(completion));
      response = cleanResponse(extractCompletionText(completion));
    }

    if (!response) {
      queueMiraObservation(ctx, env, {
        task_class: MIRA_TASK_CLASS,
        strategy_id: MIRA_STRATEGY_ID,
        model_id: modelRuntime.response_model,
        success: false,
        latency_ms: Date.now() - startedAt,
        prompt_tokens: lastUsage?.prompt_tokens,
        completion_tokens: lastUsage?.completion_tokens,
        retries,
        reliability_score: 0,
        metadata: { failure: "empty_response", provider: modelRuntime.provider, history_messages: history.length, casual, lease_grounded: Boolean(leaseGrounding?.found) }
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
      model_id: modelRuntime.response_model,
      success: true,
      latency_ms: Date.now() - startedAt,
      prompt_tokens: lastUsage?.prompt_tokens,
      completion_tokens: lastUsage?.completion_tokens,
      retries,
      reliability_score: retried ? 0.99 : 1,
      metadata: {
        provider: modelRuntime.provider,
        history_messages: history.length,
        response_chars: response.length,
        persona: "general_grounded_v5",
        casual,
        lease_grounded: Boolean(leaseGrounding?.found),
        lease_id: leaseGrounding?.lease_id || null
      }
    });

    return jsonResponse({
      message,
      response,
      action: null,
      quota,
      context: {
        history_messages_used: history.length,
        max_history_messages: MAX_HISTORY_MESSAGES,
        lease_grounding: leaseGrounding ? {
          requested: true,
          found: leaseGrounding.found,
          lease_id: leaseGrounding.lease_id
        } : null
      },
      inference: {
        response_provider: modelRuntime.provider,
        response_model: modelRuntime.response_model,
        deterministic_route: false,
        empty_response_retry: retried,
        improvement_observation: "mira",
        conversation_strategy: MIRA_STRATEGY_ID,
        casual_turn: casual,
        lease_grounded: Boolean(leaseGrounding?.found)
      }
    });
  } catch (error) {
    queueMiraObservation(ctx, env, {
      task_class: MIRA_TASK_CLASS,
      strategy_id: MIRA_STRATEGY_ID,
      model_id: modelRuntime.response_model,
      success: false,
      latency_ms: Date.now() - startedAt,
      prompt_tokens: lastUsage?.prompt_tokens,
      completion_tokens: lastUsage?.completion_tokens,
      retries,
      reliability_score: 0,
      metadata: {
        provider: modelRuntime.provider,
        failure: error?.name || error?.constructor?.name || "Error",
        history_messages: history.length,
        casual,
        lease_grounded: Boolean(leaseGrounding?.found)
      }
    });

    console.warn(JSON.stringify({
      event: "assistant_text_response_failed",
      provider: modelRuntime.provider,
      model: modelRuntime.response_model,
      error: error?.name || error?.constructor?.name || "Error"
    }));

    return jsonResponse(
      {
        error: "assistant_capacity_unavailable",
        message: "L.O.V.E. has reached its current AI capacity or the model is temporarily unavailable. Try again later.",
        quota
      },
      503
    );
  }
}

async function loadLeaseGrounding(message, env) {
  const match = String(message || "").match(LEASE_ID_PATTERN);
  if (!match) return null;

  const leaseId = match[0].toLowerCase();
  if (!env?.LEASES || typeof env.LEASES.get !== "function") {
    return { lease_id: leaseId, found: false, lease: null };
  }

  try {
    const raw = await env.LEASES.get(`lease:${leaseId}`);
    if (!raw) return { lease_id: leaseId, found: false, lease: null };
    const lease = typeof raw === "string" ? JSON.parse(raw) : raw;
    return { lease_id: leaseId, found: true, lease: leaseGroundingView(lease) };
  } catch (error) {
    console.warn(JSON.stringify({
      event: "assistant_lease_grounding_failed",
      lease_id: leaseId,
      error: error?.name || error?.constructor?.name || "Error"
    }));
    return { lease_id: leaseId, found: false, lease: null };
  }
}

function leaseGroundingView(lease) {
  const history = Array.isArray(lease?.history) ? lease.history.slice(-5).map((check) => ({
    kind: check?.kind || null,
    checked_at: check?.checked_at || null,
    result: check?.result || null,
    status: check?.status || null,
    reason: check?.reason || null,
    evidence: check?.evidence || null,
    confidence: check?.confidence ?? null,
    source_fingerprint: check?.source_fingerprint || null
  })) : [];

  return {
    lease_id: lease?.lease_id || null,
    protocol: lease?.protocol || null,
    claim: lease?.claim || null,
    issued_status: lease?.issued_status || lease?.status || null,
    current_status: lease?.current_status || lease?.revocation?.current_status || lease?.last_check?.status || lease?.status || null,
    lease_state: lease?.lease_state || null,
    source_url: lease?.source_url || null,
    final_url: lease?.final_url || null,
    issued_at: lease?.issued_at || lease?.observed_at || null,
    expires_at: lease?.expires_at || null,
    last_checked_at: lease?.last_checked_at || lease?.last_check?.checked_at || null,
    verification_count: lease?.verification_count ?? history.length,
    evidence: lease?.evidence ?? null,
    reason: lease?.reason ?? null,
    confidence: lease?.confidence ?? null,
    verifier: lease?.verifier || null,
    proof_basis: lease?.proof_basis || null,
    source_fingerprint: lease?.source_fingerprint || null,
    last_source_fingerprint: lease?.last_source_fingerprint || null,
    revocation: lease?.revocation ? {
      revoked_at: lease?.revoked_at || null,
      reason: lease?.revocation_reason || null,
      previous_status: lease.revocation?.previous_status || null,
      current_status: lease.revocation?.current_status || null,
      current_reason: lease.revocation?.current_reason || null,
      current_confidence: lease.revocation?.current_confidence ?? null,
      current_source_fingerprint: lease.revocation?.current_source_fingerprint || null
    } : null,
    history
  };
}

function isCasualSocialMessage(value) {
  const text = String(value || "").trim().toLowerCase();
  if (!text || text.length > 120) return false;

  const casualPatterns = [
    /^(hi|hey|yo|sup|hello|hiya|heya)[!.? ]*$/i,
    /^(what'?s up|whats up|wassup|wsg|wyd|you good|u good)[!.? ]*$/i,
    /^(how are you|how you doing|how'?s it going|how you doin'?|how u doing)[!.? ]*$/i,
    /^(lol|lmao|lmfao|haha|nah|naw|nope|yep|yeah|yea|bet|word|ight|aight|cool|nice|damn|bro|bruh)[!.? ]*$/i,
    /^(calm down|chill|chill out|relax)( lol| lmao)?[!.? ]*$/i,
    /^(thanks|thank you|ty|good looks|appreciate it)[!.? ]*$/i
  ];

  return casualPatterns.some((pattern) => pattern.test(text));
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
    .replace(/\*[^*\n]{1,160}\*/g, " ")
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