import { consumeAssistantQuota } from "./assistant-quota.js";

const WHISPER_MODEL = "@cf/openai/whisper";
const ASSISTANT_MODEL = "@cf/ibm-granite/granite-4.0-h-micro";
const DEFAULT_MAX_AUDIO_BYTES = 512 * 1024;
const MAX_TRANSCRIPT_CHARS = 700;

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
  { section: "home", route: "/", label: "Home", patterns: [/\bhome page\b/i, /\bhomepage\b/i, /\bgo home\b/i] }
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
        message: "You reached today's free ProofTTL AI limit. Monthly member access will unlock a larger assistant allowance when plans launch.",
        quota
      },
      429,
      { "retry-after": String(quota.retry_after_seconds) }
    );
  }

  let transcript;
  try {
    const transcription = await env.AI.run(WHISPER_MODEL, { audio: [...audio.bytes] });
    transcript = normalizeTranscript(transcription?.text);
  } catch (error) {
    console.warn(JSON.stringify({ event: "assistant_transcription_failed", error: safeErrorName(error) }));
    return aiCapacityResponse(null, quota);
  }

  if (!transcript) {
    return jsonResponse(
      { error: "speech_not_recognized", message: "I could not confidently hear a request. Try the microphone again.", quota },
      422
    );
  }

  const action = matchAssistantNavigation(transcript);
  if (action) {
    return jsonResponse({
      transcript,
      response: `Opening ${action.label}.`,
      action: { type: "navigate", route: action.route, section: action.section },
      quota,
      inference: { transcription_model: WHISPER_MODEL, response_model: null, deterministic_route: true }
    });
  }

  let responseText;
  try {
    const completion = await env.AI.run(ASSISTANT_MODEL, {
      messages: [
        { role: "system", content: assistantSystemPrompt() },
        { role: "user", content: transcript }
      ],
      max_tokens: 120,
      temperature: 0.2
    });
    responseText = cleanAssistantResponse(completion?.response);
  } catch (error) {
    console.warn(JSON.stringify({ event: "assistant_response_failed", error: safeErrorName(error) }));
    return aiCapacityResponse(transcript, quota);
  }

  return jsonResponse({
    transcript,
    response: responseText || "I can help with ProofTTL, Fact Leases, the API, x402, monitoring, payments, and product navigation.",
    action: null,
    quota,
    inference: { transcription_model: WHISPER_MODEL, response_model: ASSISTANT_MODEL, deterministic_route: false }
  });
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

export function assistantSystemPrompt() {
  return [
    "You are the ProofTTL product assistant.",
    "Answer only questions about ProofTTL and its documented product behavior.",
    "ProofTTL issues source-backed, expiring Fact Leases for precise claims.",
    "A lease records claim, source, evidence, verdict, fingerprint, TTL, issued status, and current state.",
    "Verdicts are SUPPORTED, CONTRADICTED, or UNKNOWN. Lease states are ACTIVE, REVOKED, or EXPIRED.",
    "POST /verify uses x402 and currently costs $0.001 USDC on Base Sepolia testnet per Fact Lease issuance.",
    "GET /lease/:id reads a lease. Automatic monitoring can revoke an active lease when evidence no longer maintains its verdict.",
    "Never invent account data, payment history, lease state, customer data, uptime, or actions you did not perform.",
    "If asked about something outside ProofTTL, say you only handle ProofTTL product questions.",
    "Keep responses concise and useful."
  ].join(" ");
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

function positiveInt(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function parseContentLength(value) {
  if (value === null || value === "") return null;
  if (!/^\d+$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function audioTooLarge(maxBytes) {
  return jsonResponse(
    { error: "assistant_audio_too_large", message: `Keep microphone recordings under ${maxBytes} bytes.`, max_bytes: maxBytes },
    413
  );
}

function aiCapacityResponse(transcript = null, quota = null) {
  return jsonResponse(
    {
      error: "assistant_capacity_unavailable",
      message: "ProofTTL voice assistance has reached its current free AI capacity or the model is temporarily unavailable. Try again later.",
      ...(transcript ? { transcript } : {}),
      ...(quota ? { quota } : {})
    },
    503
  );
}

function safeErrorName(error) {
  return error?.name || error?.constructor?.name || "Error";
}

function jsonResponse(body, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...extraHeaders }
  });
}

export const ASSISTANT_MODELS = Object.freeze({ transcription: WHISPER_MODEL, response: ASSISTANT_MODEL });
export const ASSISTANT_LIMITS = Object.freeze({ maxAudioBytes: DEFAULT_MAX_AUDIO_BYTES, maxTranscriptChars: MAX_TRANSCRIPT_CHARS });
