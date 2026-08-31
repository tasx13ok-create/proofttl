import { assistantSystemPrompt, matchAssistantNavigation } from "./assistant.js";
import {
  assistantModelRuntime,
  assistantResponseProviderAvailable,
  runAssistantResponse
} from "./assistant-model-router.js";
import { consumeAssistantQuota, getAssistantQuota } from "./assistant-quota.js";
import { recordMiraObservation } from "./mira.js";

const MAX_TEXT_CHARS = 1200;
const MAX_HISTORY_MESSAGES = 6;
const MAX_HISTORY_MESSAGE_CHARS = 600;
const MAX_RESPONSE_CHARS = 7000;
const MIRA_TASK_CLASS = "assistant_text_chat";
const MIRA_STRATEGY_ID = "proofttl_product_only_v1";
const LEASE_ID_PATTERN = /\bftl_[a-f0-9]{16,64}\b/i;
const PROOFTTL_TOPIC = /\b(proofttl|fact\s+audit|audit|claim|evidence|source|verify|verification|verdict|fact\s+lease|lease|scope|stripe|payment|checkout|paid|fulfill|fulfillment|report|proof|monitor|monitoring|watch|human\s+approval|sign[ -]?in|session|account|status|pricing|price)\b/i;
const BOUNDARY_RESPONSE = "I can only help with ProofTTL: the $1,500 Fact Audit, claims, evidence, audit status, account access, payments, fulfillment, monitoring, and Fact Leases.";

export async function handleTextAssistant(request, env, ctx = null) {
  if (request.method !== "POST") {
    return jsonResponse({ error: "method_not_allowed", message: "Use POST with application/json and a message field." }, 405, { allow: "POST, OPTIONS" });
  }
  if (!assistantResponseProviderAvailable(env)) {
    return jsonResponse({ error: "assistant_unavailable", message: "ProofTTL assistance is not available right now." }, 503);
  }
  const contentType = request.headers.get("content-type") || "";
  if (!contentType.toLowerCase().includes("application/json")) {
    return jsonResponse({ error: "json_content_type_required", message: "Send application/json with a message field." }, 415);
  }
  const limiter = env.ASSISTANT_RATE_LIMITER;
  if (!limiter || typeof limiter.limit !== "function") {
    return jsonResponse({ error: "assistant_rate_limiter_unavailable", message: "ProofTTL assistance is not configured safely yet." }, 503);
  }
  const { success } = await limiter.limit({ key: assistantRateLimitKey(request) });
  if (!success) {
    return jsonResponse({ error: "assistant_rate_limit_exceeded", message: "Too many assistant requests. Try again shortly." }, 429, { "retry-after": "60" });
  }

  let body;
  try { body = await request.json(); }
  catch { return jsonResponse({ error: "invalid_json", message: "The assistant request body must be valid JSON." }, 400); }

  const message = normalizeMessage(body?.message);
  if (!message) return jsonResponse({ error: "message_required", message: "Enter a message." }, 400);
  const history = normalizeHistory(body?.history);

  const action = matchAssistantNavigation(message);
  if (action) {
    const quota = await getAssistantQuota(request, env);
    return jsonResponse({
      message,
      response: `Opening ${action.label}.`,
      action: { type: "navigate", route: action.route, section: action.section },
      quota,
      inference: { response_model: null, deterministic_route: true, scope: "proofttl_only" }
    });
  }

  const leaseGrounding = await loadLeaseGrounding(message, env);
  const inheritedProofTTL = history.some((item) => PROOFTTL_TOPIC.test(item.content));
  const inScope = Boolean(leaseGrounding || PROOFTTL_TOPIC.test(message) || inheritedProofTTL);
  if (!inScope) {
    const quota = await getAssistantQuota(request, env);
    return jsonResponse({
      message,
      response: BOUNDARY_RESPONSE,
      action: null,
      quota,
      context: { history_messages_used: history.length, max_history_messages: MAX_HISTORY_MESSAGES, lease_grounding: null },
      inference: { response_model: null, deterministic_route: true, scope: "proofttl_only", rejected_out_of_scope: true }
    });
  }

  const quota = await consumeAssistantQuota(request, env);
  if (!quota.allowed) {
    return jsonResponse({ error: "assistant_free_limit_reached", message: "You reached today's ProofTTL AI limit.", quota }, 429, { "retry-after": String(quota.retry_after_seconds) });
  }

  const startedAt = Date.now();
  const modelRuntime = assistantModelRuntime(env);
  let usage = null;
  try {
    const messages = [
      { role: "system", content: assistantSystemPrompt() },
      ...(leaseGrounding ? [{ role: "system", content: leaseGrounding.found
        ? `Authoritative live Fact Lease data follows. Treat these fields as the only source of truth for this Lease. If a requested detail is absent, say it is not present. DATA=${JSON.stringify(leaseGrounding.lease)}`
        : `The user referenced Fact Lease ${leaseGrounding.lease_id}, but ProofTTL storage did not return that Lease. Say it was not found and do not invent any Lease fields.` }] : []),
      ...history,
      { role: "user", content: message }
    ];

    const completion = await runAssistantResponse(env, { messages, max_tokens: 420, temperature: leaseGrounding?.found ? 0.1 : 0.22 });
    usage = extractUsage(completion);
    const response = cleanResponse(extractCompletionText(completion));
    if (!response) {
      queueMiraObservation(ctx, env, {
        task_class: MIRA_TASK_CLASS, strategy_id: MIRA_STRATEGY_ID, model_id: modelRuntime.response_model,
        success: false, latency_ms: Date.now() - startedAt, prompt_tokens: usage?.prompt_tokens,
        completion_tokens: usage?.completion_tokens, retries: 0, reliability_score: 0,
        metadata: { failure: "empty_response", provider: modelRuntime.provider, history_messages: history.length, lease_grounded: Boolean(leaseGrounding?.found) }
      });
      return jsonResponse({ error: "assistant_empty_response", message: "ProofTTL did not produce a usable reply. Try that message again.", quota }, 503);
    }

    queueMiraObservation(ctx, env, {
      task_class: MIRA_TASK_CLASS, strategy_id: MIRA_STRATEGY_ID, model_id: modelRuntime.response_model,
      success: true, latency_ms: Date.now() - startedAt, prompt_tokens: usage?.prompt_tokens,
      completion_tokens: usage?.completion_tokens, retries: 0, reliability_score: 1,
      metadata: { provider: modelRuntime.provider, history_messages: history.length, response_chars: response.length, scope: "proofttl_only", lease_grounded: Boolean(leaseGrounding?.found), lease_id: leaseGrounding?.lease_id || null }
    });

    return jsonResponse({
      message,
      response,
      action: null,
      quota,
      context: {
        history_messages_used: history.length,
        max_history_messages: MAX_HISTORY_MESSAGES,
        lease_grounding: leaseGrounding ? { requested: true, found: leaseGrounding.found, lease_id: leaseGrounding.lease_id } : null
      },
      inference: {
        response_provider: modelRuntime.provider,
        response_model: modelRuntime.response_model,
        deterministic_route: false,
        improvement_observation: "mira",
        conversation_strategy: MIRA_STRATEGY_ID,
        scope: "proofttl_only",
        lease_grounded: Boolean(leaseGrounding?.found)
      }
    });
  } catch (error) {
    queueMiraObservation(ctx, env, {
      task_class: MIRA_TASK_CLASS, strategy_id: MIRA_STRATEGY_ID, model_id: modelRuntime.response_model,
      success: false, latency_ms: Date.now() - startedAt, prompt_tokens: usage?.prompt_tokens,
      completion_tokens: usage?.completion_tokens, retries: 0, reliability_score: 0,
      metadata: { provider: modelRuntime.provider, failure: error?.name || error?.constructor?.name || "Error", history_messages: history.length, scope: "proofttl_only", lease_grounded: Boolean(leaseGrounding?.found) }
    });
    console.warn(JSON.stringify({ event: "assistant_text_response_failed", provider: modelRuntime.provider, model: modelRuntime.response_model, error: error?.name || error?.constructor?.name || "Error" }));
    return jsonResponse({ error: "assistant_capacity_unavailable", message: "ProofTTL assistance is temporarily unavailable. Try again later.", quota }, 503);
  }
}

async function loadLeaseGrounding(message, env) {
  const match = String(message || "").match(LEASE_ID_PATTERN);
  if (!match) return null;
  const leaseId = match[0].toLowerCase();
  if (!env?.LEASES || typeof env.LEASES.get !== "function") return { lease_id: leaseId, found: false, lease: null };
  try {
    const raw = await env.LEASES.get(`lease:${leaseId}`);
    if (!raw) return { lease_id: leaseId, found: false, lease: null };
    const lease = typeof raw === "string" ? JSON.parse(raw) : raw;
    return { lease_id: leaseId, found: true, lease: leaseGroundingView(lease) };
  } catch (error) {
    console.warn(JSON.stringify({ event: "assistant_lease_grounding_failed", lease_id: leaseId, error: error?.name || error?.constructor?.name || "Error" }));
    return { lease_id: leaseId, found: false, lease: null };
  }
}

function leaseGroundingView(lease) {
  const history = Array.isArray(lease?.history) ? lease.history.slice(-5).map((check) => ({
    kind: check?.kind || null, checked_at: check?.checked_at || null, result: check?.result || null,
    status: check?.status || null, reason: check?.reason || null, evidence: check?.evidence || null,
    confidence: check?.confidence ?? null, source_fingerprint: check?.source_fingerprint || null
  })) : [];
  return {
    lease_id: lease?.lease_id || null, protocol: lease?.protocol || null, claim: lease?.claim || null,
    issued_status: lease?.issued_status || lease?.status || null,
    current_status: lease?.current_status || lease?.revocation?.current_status || lease?.last_check?.status || lease?.status || null,
    lease_state: lease?.lease_state || null, source_url: lease?.source_url || null, final_url: lease?.final_url || null,
    issued_at: lease?.issued_at || lease?.observed_at || null, expires_at: lease?.expires_at || null,
    last_checked_at: lease?.last_checked_at || lease?.last_check?.checked_at || null,
    verification_count: lease?.verification_count ?? history.length, evidence: lease?.evidence ?? null,
    reason: lease?.reason ?? null, confidence: lease?.confidence ?? null, verifier: lease?.verifier || null,
    proof_basis: lease?.proof_basis || null, source_fingerprint: lease?.source_fingerprint || null,
    last_source_fingerprint: lease?.last_source_fingerprint || null,
    revocation: lease?.revocation ? {
      revoked_at: lease?.revoked_at || null, reason: lease?.revocation_reason || null,
      previous_status: lease.revocation?.previous_status || null, current_status: lease.revocation?.current_status || null,
      current_reason: lease.revocation?.current_reason || null, current_confidence: lease.revocation?.current_confidence ?? null,
      current_source_fingerprint: lease.revocation?.current_source_fingerprint || null
    } : null,
    history
  };
}

function normalizeMessage(value) {
  return typeof value === "string" ? value.trim().slice(0, MAX_TEXT_CHARS) : "";
}

function normalizeHistory(value) {
  if (!Array.isArray(value)) return [];
  return value.slice(-MAX_HISTORY_MESSAGES).flatMap((item) => {
    if (!item || !["user", "assistant"].includes(item.role) || typeof item.content !== "string") return [];
    const content = item.content.trim().slice(0, MAX_HISTORY_MESSAGE_CHARS);
    return content ? [{ role: item.role, content }] : [];
  });
}

function extractCompletionText(value) {
  if (typeof value === "string") return value;
  const candidates = [value?.response, value?.result?.response, value?.choices?.[0]?.message?.content, value?.result?.choices?.[0]?.message?.content];
  return candidates.find((item) => typeof item === "string") || "";
}

function cleanResponse(value) {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, MAX_RESPONSE_CHARS);
}

function extractUsage(value) {
  const usage = value?.usage || value?.result?.usage;
  if (!usage) return null;
  return {
    prompt_tokens: finiteNonNegative(usage.prompt_tokens ?? usage.input_tokens),
    completion_tokens: finiteNonNegative(usage.completion_tokens ?? usage.output_tokens)
  };
}

function finiteNonNegative(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function queueMiraObservation(ctx, env, observation) {
  if (!env?.MONITOR_DB) return;
  const work = recordMiraObservation(env, observation).catch((error) => {
    console.warn(JSON.stringify({ event: "mira_assistant_observation_failed", error: error?.name || "Error" }));
  });
  if (ctx?.waitUntil) ctx.waitUntil(work);
}

function assistantRateLimitKey(request) {
  const ip = request.headers.get("cf-connecting-ip") || "anonymous";
  return `assistant:text:${String(ip).trim().slice(0, 120)}`;
}

function jsonResponse(body, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...extraHeaders }
  });
}

export const ASSISTANT_TEXT_SCOPE = "proofttl_only";
