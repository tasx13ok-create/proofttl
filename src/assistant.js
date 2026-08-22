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
  const privileged = (quota?.plan === "member" || quota?.plan === "owner") && quota?.membership_status === "active";
  const modelRuntime = assistantModelRuntime(env);
  return {
    persona: "L.O.V.E.",
    voice_mode: privileged || preview,
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

function assistantRateLimitKey(request) {
  const ip = request.headers.get("cf-connecting-ip") || "anonymous";
  return `assistant:${ip.trim().slice(0, 120)}`;
}

function parseContentLength(value) {
  if (!value) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

async function readRequestBytesLimited(request, maxBytes) {
  try {
    const body = request.body;
    if (!body || typeof body.getReader !== "function") {
      const buffer = await request.arrayBuffer();
      return buffer.byteLength > maxBytes
        ? { ok: false, error: "too_large" }
        : { ok: true, bytes: new Uint8Array(buffer) };
    }

    const reader = body.getReader();
    const chunks = [];
    let total = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        try { await reader.cancel(); } catch {}
        return { ok: false, error: "too_large" };
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return { ok: true, bytes };
  } catch {
    return { ok: false, error: "unreadable" };
  }
}

function audioTooLarge(maxBytes) {
  return jsonResponse(
    {
      error: "audio_too_large",
      message: `Keep the recording under ${Math.floor(maxBytes / 1024)} KB.`,
      max_bytes: maxBytes
    },
    413
  );
}

function normalizeTranscript(value) {
  return typeof value === "string"
    ? value.trim().replace(/\s+/g, " ").slice(0, MAX_TRANSCRIPT_CHARS)
    : "";
}

function extractAssistantResponse(value) {
  if (typeof value === "string") return value;
  if (typeof value?.response === "string") return value.response;
  if (typeof value?.result?.response === "string") return value.result.response;
  if (typeof value?.choices?.[0]?.message?.content === "string") {
    return value.choices[0].message.content;
  }
  return "";
}

function cleanAssistantResponse(value) {
  if (typeof value !== "string") return "";
  return value.trim().replace(/\s+/g, " ").slice(0, 900);
}

function conversationalFallback(transcript) {
  const normalized = transcript.toLowerCase().replace(/[^a-z0-9\s']/g, " ").replace(/\s+/g, " ").trim();
  if (/^(hi|hey|hello|yo|sup|what's up|whats up|you there|are you there)$/.test(normalized)) {
    return "I'm here. What do you want to work on?";
  }
  if (/\b(can you hear me|do you hear me|are you listening)\b/.test(normalized)) {
    return "Yeah, I can hear you. Go ahead.";
  }
  return "I'm with you. Keep going.";
}

function assistantSystemPrompt() {
  return [
    "You are L.O.V.E., the general-purpose intelligence and control layer for the ProofTTL Workspace.",
    "You are not limited to ProofTTL product support. Answer normal conversation and substantive questions naturally when you can.",
    "Be concise, natural, competent, and context-aware.",
    "Do not repeatedly introduce yourself, advertise ProofTTL, or force unrelated conversation back to the product.",
    "Never invent private account data, transactions, emails, files, balances, provider state, or actions that were not actually supplied by a trusted tool or application context.",
    "If authoritative Fact Lease context is supplied, use it for those specific facts and do not invent missing fields.",
    "Never pretend to execute an action unless the capability layer confirms it."
  ].join(" ");
}

async function aiCapacityResponse(transcript, quota) {
  return jsonResponse(
    {
      error: "assistant_capacity_unavailable",
      message: "L.O.V.E. is temporarily unavailable. No paid fallback was used.",
      transcript,
      quota
    },
    503,
    { "retry-after": "30" }
  );
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

function positiveInt(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function safeErrorName(error) {
  return error?.name || error?.constructor?.name || "Error";
}

export const ASSISTANT_MODELS = Object.freeze({
  transcription: WHISPER_MODEL,
  response: DEFAULT_ASSISTANT_RESPONSE_MODEL,
  speech: LOVE_TTS_MODEL
});
