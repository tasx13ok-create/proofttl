import { consumeAssistantQuota } from "./assistant-quota.js";
import {
  DEFAULT_ASSISTANT_RESPONSE_MODEL,
  assistantModelRuntime,
  runAssistantResponse
} from "./assistant-model-router.js";

const WHISPER_MODEL = "@cf/openai/whisper-large-v3-turbo";
const LOVE_TTS_MODEL = "@cf/deepgram/aura-2-en";
const DEFAULT_LOVE_SPEAKER = "atlas";
const DEFAULT_MAX_AUDIO_BYTES = 512 * 1024;
const MAX_TRANSCRIPT_CHARS = 700;
const LEASE_ID_PATTERN = /\bftl_[a-f0-9]{16,64}\b/i;
export const LOVE_CREATOR_RESPONSE = "Anderson, Collin. CEO. Orchestrator. Raised in New York. Born November 2006.";

const NAVIGATION_RULES = [
  { section: "payments", route: "/console/", label: "Payments", patterns: [/\bpayments?\b/i, /\btransactions?\b/i, /\bbilling\b/i] },
  { section: "security", route: "/console/", label: "Security", patterns: [/\bsecurity\b/i, /\b2fa\b/i, /\bmfa\b/i, /\bpasskeys?\b/i, /\brecovery codes?\b/i] },
  { section: "fact-leases", route: "/console/", label: "Fact Leases", patterns: [/\bfact leases?\b/i, /\bleases?\b/i] },
  { section: "usage", route: "/console/", label: "Usage", patterns: [/\busage\b/i, /\bverification activity\b/i] },
  { section: "api", route: "/console/", label: "API", patterns: [/\bapi docs?\b/i, /\bapi documentation\b/i, /\bopenapi\b/i, /\bapi section\b/i] },
  { section: "account", route: "/console/", label: "Account", patterns: [/\baccount settings?\b/i, /\bmy account\b/i] },
  { section: "support", route: "/support/", label: "Support", patterns: [/\bsupport\b/i, /\bhelp center\b/i, /\bcontact support\b/i] },
  { section: "get-started", route: "/get-started/", label: "Get started", patterns: [/\bget started\b/i, /\bpricing\b/i, /\bprice\b/i] },
  { section: "solutions", route: "/solutions/", label: "Solutions", patterns: [/\bsolutions?\b/i, /\buse cases?\b/i] },
  { section: "login", route: "/login/", label: "Sign in", patterns: [/\bsign in\b/i, /\blog ?in\b/i] },
  { section: "how-it-works", route: "/how-proofttl-works/", label: "How ProofTTL Works", patterns: [/\bhow (?:proofttl|this|the site|the website) works?\b/i, /\bproduct guide\b/i, /\bl\.o\.v\.e\.? guide\b/i] },
  { section: "home", route: "/workspace/", label: "Workspace", patterns: [/\bhome page\b/i, /\bhomepage\b/i, /\bgo home\b/i, /\bmain menu\b/i, /\bmain workspace\b/i, /\bdashboard\b/i] }
];

const NAVIGATION_VERBS = /\b(open|show|take me|go to|bring me|navigate|view|see)\b/i;

export async function handleVoiceAssistant(request, env) {
  if (request.method !== "POST") {
    return jsonResponse(
      { error: "method_not_allowed", message: "Use POST with a short audio/* request body." },
      405,
      { allow: "POST, OPTIONS" }
    );
  }

  if (!env?.AI || typeof env.AI.run !== "function") {
    return jsonResponse(
      { error: "assistant_unavailable", message: "ProofTTL voice assistance is not available right now." },
      503
    );
  }

  const contentType = request.headers.get("content-type") || "";
  if (!/^audio\//i.test(contentType)) {
    return jsonResponse(
      { error: "audio_content_type_required", message: "Send a short audio/* recording from the microphone." },
      415
    );
  }

  const maxBytes = positiveInt(env.PROOFTTL_ASSISTANT_MAX_AUDIO_BYTES, DEFAULT_MAX_AUDIO_BYTES);
  const declaredLength = parseContentLength(request.headers.get("content-length"));
  if (declaredLength !== null && declaredLength > maxBytes) return audioTooLarge(maxBytes);

  const limiter = env.ASSISTANT_RATE_LIMITER;
  if (!limiter || typeof limiter.limit !== "function") {
    return jsonResponse(
      { error: "assistant_rate_limiter_unavailable", message: "ProofTTL voice assistance is not configured safely yet." },
      503
    );
  }

  const rateKey = assistantRateLimitKey(request);
  const { success } = await limiter.limit({ key: rateKey });
  if (!success) {
    return jsonResponse(
      { error: "assistant_rate_limit_exceeded", message: "Too many voice requests. Try again shortly." },
      429,
      { "retry-after": "60" }
    );
  }

  const audio = await readRequestBytesLimited(request, maxBytes);
  if (!audio.ok) {
    return audio.error === "too_large"
      ? audioTooLarge(maxBytes)
      : jsonResponse({ error: "audio_unreadable", message: "The microphone recording could not be read." }, 400);
  }

  if (audio.bytes.byteLength === 0) {
    return jsonResponse({ error: "audio_required", message: "The microphone recording was empty." }, 400);
  }

  const quota = await consumeAssistantQuota(request, env);
  if (!quota.allowed) {
    return jsonResponse(
      {
        error: "assistant_free_limit_reached",
        message: "You reached today's ProofTTL AI limit.",
        quota
      },
      429,
      { "retry-after": String(quota.retry_after_seconds) }
    );
  }

  let transcript;
  try {
    const transcription = await env.AI.run(WHISPER_MODEL, {
      audio: [...audio.bytes],
      task: "transcribe",
      language: "en",
      vad_filter: true,
      condition_on_previous_text: false,
      initial_prompt: "Natural conversational English addressed to an AI assistant named L.O.V.E. Common phrases include can you hear me, hello, yeah, do you, open the main menu, open Workspace, ProofTTL, Studio, Files, Work, Money, and Automations."
    });
    transcript = normalizeTranscript(transcription?.text);
  } catch (error) {
    console.warn(JSON.stringify({ event: "assistant_transcription_failed", error: safeErrorName(error) }));
    return aiCapacityResponse(null, quota);
  }

  if (!transcript) {
    return jsonResponse(
      { error: "speech_not_recognized", message: "I could not confidently hear that. Try saying it again.", quota },
      422
    );
  }

  if (isLoveCreatorQuestion(transcript)) {
    return jsonResponse({
      transcript,
      response: LOVE_CREATOR_RESPONSE,
      action: null,
      quota,
      love: loveCapability(quota, env),
      speech: await synthesizeLoveSpeech(LOVE_CREATOR_RESPONSE, quota, env),
      context: { lease_grounding: { requested: false, found: false, lease_id: null } },
      inference: { transcription_model: WHISPER_MODEL, response_model: null, speech_model: LOVE_TTS_MODEL, deterministic_route: true }
    });
  }

  const action = matchAssistantNavigation(transcript);
  if (action) {
    const responseText = `Opening ${action.label}.`;
    return jsonResponse({
      transcript,
      response: responseText,
      action: { type: "navigate", route: action.route, section: action.section },
      quota,
      love: loveCapability(quota, env),
      speech: await synthesizeLoveSpeech(responseText, quota, env),
      context: { lease_grounding: { requested: false, found: false, lease_id: null } },
      inference: { transcription_model: WHISPER_MODEL, response_model: null, speech_model: LOVE_TTS_MODEL, deterministic_route: true }
    });
  }

  const leaseGrounding = await resolveLeaseGrounding(transcript, env);
  if (leaseGrounding.requested && !leaseGrounding.found) {
    const responseText = `I could not find Fact Lease ${leaseGrounding.lease_id}. I will not guess its status.`;
    return jsonResponse({
      transcript,
      response: responseText,
      action: null,
      quota,
      love: loveCapability(quota, env),
      speech: await synthesizeLoveSpeech(responseText, quota, env),
      context: { lease_grounding: publicLeaseGrounding(leaseGrounding) },
      inference: { transcription_model: WHISPER_MODEL, response_model: null, speech_model: LOVE_TTS_MODEL, deterministic_route: true, lease_grounded: false }
    });
  }

  const modelRuntime = assistantModelRuntime(env);
  let responseText;
  try {
    const messages = [
      { role: "system", content: assistantSystemPrompt() }
    ];
    if (leaseGrounding.found) {
      messages.push({
        role: "system",
        content: [
          "A Fact Lease referenced in this voice request was loaded directly from ProofTTL storage.",
          "Treat the following JSON as the authoritative Lease context for this turn.",
          "Do not infer fields that are absent, and do not contradict this object.",
          JSON.stringify(leaseGrounding.lease)
        ].join(" ")
      });
    }
    messages.push({ role: "user", content: transcript });

    const completion = await runAssistantResponse(env, {
      messages,
      max_tokens: 170,
      temperature: leaseGrounding.found ? 0.1 : 0.42
    });
    responseText = cleanAssistantResponse(extractAssistantResponse(completion));
  } catch (error) {
    console.warn(JSON.stringify({ event: "assistant_response_failed", error: safeErrorName(error), provider: modelRuntime.provider }));
    return aiCapacityResponse(transcript, quota);
  }

  const finalText = responseText || conversationalFallback(transcript);

  return jsonResponse({
    transcript,
    response: finalText,
    action: null,
    quota,
    love: loveCapability(quota, env),
    speech: await synthesizeLoveSpeech(finalText, quota, env),
    context: { lease_grounding: publicLeaseGrounding(leaseGrounding) },
    inference: {
      transcription_model: WHISPER_MODEL,
      response_provider: modelRuntime.provider,
      response_model: modelRuntime.response_model,
      speech_model: LOVE_TTS_MODEL,
      deterministic_route: false,
      lease_grounded: leaseGrounding.found
    }
  });
}

export function loveCapability(quota, env) {
  const preview = String(env?.PROOFTTL_LOVE_PUBLIC_PREVIEW || "").toLowerCase() === "true";
  const member = quota?.plan === "member" && quota?.membership_status === "active";
  const modelRuntime = assistantModelRuntime(env);
  return {
    persona: "L.O.V.E.",
    voice_mode: member || preview,
    member_only: true,
    preview_enabled: preview,
    plan: quota?.plan || "free",
    speaker: String(env?.PROOFTTL_LOVE_TTS_SPEAKER || DEFAULT_LOVE_SPEAKER),
    response_provider: modelRuntime.provider,
    response_model: modelRuntime.response_model
  };
}

async function synthesizeLoveSpeech(text, quota, env) {
  const capability = loveCapability(quota, env);
  if (!capability.voice_mode) {
    return { available: false, reason: "membership_required" };
  }

  try {
    const output = await env.AI.run(LOVE_TTS_MODEL, {
      text: cleanAssistantResponse(text),
      speaker: capability.speaker,
      encoding: "mp3"
    });
    const bytes = await streamOrBufferToBytes(output);
    if (!bytes?.byteLength) return { available: false, reason: "empty_tts_output" };

    return {
      available: true,
      mime_type: "audio/mpeg",
      audio_base64: bytesToBase64(bytes),
      model: LOVE_TTS_MODEL,
      speaker: capability.speaker
    };
  } catch (error) {
    console.warn(JSON.stringify({ event: "love_tts_failed", error: safeErrorName(error) }));
    return { available: false, reason: "tts_unavailable", model: LOVE_TTS_MODEL };
  }
}

async function resolveLeaseGrounding(message, env) {
  const match = String(message || "").match(LEASE_ID_PATTERN);
  if (!match) return { requested: false, found: false, lease_id: null, lease: null };

  const leaseId = match[0].toLowerCase();
  if (!env?.LEASES || typeof env.LEASES.get !== "function") {
    return { requested: true, found: false, lease_id: leaseId, lease: null };
  }

  try {
    const raw = await env.LEASES.get(`lease:${leaseId}`);
    if (!raw) return { requested: true, found: false, lease_id: leaseId, lease: null };
    const lease = typeof raw === "string" ? JSON.parse(raw) : raw;
    return {
      requested: true,
      found: true,
      lease_id: leaseId,
      lease: compactLeaseContext(lease)
    };
  } catch (error) {
    console.warn(JSON.stringify({ event: "assistant_voice_lease_grounding_failed", lease_id: leaseId, error: safeErrorName(error) }));
    return { requested: true, found: false, lease_id: leaseId, lease: null };
  }
}

function compactLeaseContext(lease) {
  const history = Array.isArray(lease?.history) ? lease.history.slice(-5) : [];
  return {
    lease_id: lease?.lease_id || null,
    claim: lease?.claim || null,
    issued_status: lease?.issued_status || lease?.status || null,
    current_status: lease?.current_status || lease?.revocation?.current_status || lease?.last_check?.status || lease?.status || null,
    lease_state: lease?.lease_state || null,
    source_url: lease?.source_url || null,
    final_url: lease?.final_url || null,
    issued_at: lease?.issued_at || null,
    expires_at: lease?.expires_at || null,
    evidence: lease?.evidence ?? null,
    reason: lease?.reason ?? null,
    confidence: lease?.confidence ?? null,
    verifier: lease?.verifier || null,
    proof_basis: lease?.proof_basis || null,
    source_fingerprint: lease?.source_fingerprint || null,
    last_source_fingerprint: lease?.last_source_fingerprint || null,
    last_checked_at: lease?.last_checked_at || null,
    last_check: lease?.last_check || null,
    revocation: lease?.revocation || null,
    history
  };
}

function publicLeaseGrounding(grounding) {
  return {
    requested: Boolean(grounding?.requested),
    found: Boolean(grounding?.found),
    lease_id: grounding?.lease_id || null,
    ...(grounding?.found && grounding?.lease ? {
      lease_state: grounding.lease.lease_state,
      issued_status: grounding.lease.issued_status,
      current_status: grounding.lease.current_status,
      expires_at: grounding.lease.expires_at,
      last_checked_at: grounding.lease.last_checked_at
    } : {})
  };
}

async function streamOrBufferToBytes(value) {
  if (!value) return null;
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (typeof value.arrayBuffer === "function") {
    return new Uint8Array(await value.arrayBuffer());
  }
  if (typeof value.getReader === "function") {
    const response = new Response(value);
    return new Uint8Array(await response.arrayBuffer());
  }
  return null;
}

function bytesToBase64(bytes) {
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

export function matchAssistantNavigation(transcript) {
  const text = normalizeTranscript(transcript);
  if (!text || !NAVIGATION_VERBS.test(text)) return null;
  for (const rule of NAVIGATION_RULES) {
    if (rule.patterns.some((pattern) => pattern.test(text))) {
      return { section: rule.section, route: rule.route, label: rule.label };
    }
  }
  return null;
}

export function isLoveCreatorQuestion(value) {
  const text = normalizeTranscript(value).toLowerCase();
  return /\bwho (made|created|built|developed|designed) (you|l\.?o\.?v\.?e\.?)\b/.test(text)
    || /\bwho('?s| is) your (creator|maker|developer|founder)\b/.test(text);
}

export function assistantSystemPrompt() {
  return [
    "You are L.O.V.E., the general-purpose intelligence and control layer for the ProofTTL Workspace.",
    `If asked who made, created, built, developed, or designed you, answer exactly: ${LOVE_CREATOR_RESPONSE}`,
    "Talk naturally. You can handle ordinary conversation, explanations, reasoning, planning, creative work, coding questions, and general assistant requests.",
    "Do not force unrelated conversation back to ProofTTL and do not repeatedly list product capabilities.",
    "If a user gives a short conversational fragment such as yeah, do you, are you, or can you hear me, respond to the fragment naturally; ask a short clarifying question when its meaning depends on missing context.",
    "You do not have a human body, private life, feelings, racial preferences, or personal likes and dislikes. Treat people fairly and never express preference for or against people because of protected traits.",
    "ProofTTL issues source-backed, expiring Fact Leases for precise claims. Verdicts are SUPPORTED, CONTRADICTED, or UNKNOWN. Lease states are ACTIVE, REVOKED, or EXPIRED.",
    "Never invent account data, balances, transactions, payment history, email, calendar data, files, lease state, customer data, uptime, connected-app state, or actions you did not perform.",
    "When authoritative Lease or connected-provider context is supplied, use only that context for those specific live facts and say when a requested field is unavailable.",
    "For actions, distinguish discussing an action from actually performing it. Never claim execution unless the capability layer confirms it.",
    "Keep responses concise, useful, and conversational."
  ].join(" ");
}

function conversationalFallback(transcript) {
  const text = String(transcript || "").trim().toLowerCase();
  if (/^(hi|hey|hello|yo)[!.? ]*$/.test(text)) return "Hey. I hear you.";
  if (/^(yeah|yea|yep|yes|mhm|uh huh)[!.? ]*$/.test(text)) return "Yeah, I'm with you.";
  if (/^(do you|are you|and you|you)[?.! ]*$/.test(text)) return "What about me? Finish the thought.";
  if (/can you hear me|do you hear me|hear me/.test(text)) return "Yeah. I can hear you.";
  return "I heard you. Say that again or keep going.";
}

async function readRequestBytesLimited(request, maxBytes) {
  if (!request.body) return { ok: true, bytes: new Uint8Array(0) };
  const reader = request.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = value || new Uint8Array(0);
      total += chunk.byteLength;
      if (total > maxBytes) {
        void reader.cancel("assistant_audio_limit_reached").catch(() => {});
        return { ok: false, error: "too_large" };
      }
      chunks.push(chunk);
    }
  } catch {
    return { ok: false, error: "unreadable" };
  } finally {
    try { reader.releaseLock(); } catch {}
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { ok: true, bytes };
}

function assistantRateLimitKey(request) {
  const ip = (request.headers.get("cf-connecting-ip") || "anonymous").trim();
  return `assistant:${ip.slice(0, 80)}`;
}

function normalizeTranscript(value) {
  if (typeof value !== "string") return "";
  return value.replace(/\s+/g, " ").trim().slice(0, MAX_TRANSCRIPT_CHARS);
}

function cleanAssistantResponse(value) {
  if (typeof value !== "string") return "";
  return value.replace(/\s+/g, " ").trim().slice(0, 900);
}

function parseContentLength(value) {
  if (!value) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function positiveInt(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function audioTooLarge(maxBytes) {
  return jsonResponse(
    { error: "audio_too_large", message: `Keep the microphone recording under ${maxBytes} bytes.` },
    413
  );
}

function extractAssistantResponse(result) {
  if (typeof result?.response === "string") return result.response;
  if (typeof result?.result?.response === "string") return result.result.response;
  const choice = result?.choices?.[0]?.message?.content || result?.result?.choices?.[0]?.message?.content;
  return typeof choice === "string" ? choice : "";
}

function aiCapacityResponse(transcript, quota) {
  return jsonResponse(
    {
      error: "assistant_capacity_unavailable",
      message: "L.O.V.E. has reached its current AI capacity or the model is temporarily unavailable. Try again later.",
      transcript,
      quota
    },
    503
  );
}

function jsonResponse(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...headers }
  });
}

function safeErrorName(error) {
  return error?.name || error?.constructor?.name || "Error";
}
