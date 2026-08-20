import { getAssistantQuota } from './assistant-quota.js';
import { loveCapability } from './assistant.js';

const LOVE_TTS_MODEL = '@cf/deepgram/aura-2-en';
const MAX_SPEECH_CHARS = 900;

export async function handleAssistantSpeech(request, env) {
  if (request.method !== 'POST') return json({ error: 'method_not_allowed', message: 'Use POST with application/json.' }, 405, { allow: 'POST, OPTIONS' });
  if (!env?.AI || typeof env.AI.run !== 'function') return json({ error: 'tts_unavailable', message: 'L.O.V.E. speech synthesis is not configured.' }, 503);

  const contentType = request.headers.get('content-type') || '';
  if (!contentType.toLowerCase().includes('application/json')) return json({ error: 'json_content_type_required', message: 'Send application/json with a text field.' }, 415);

  const limiter = env.ASSISTANT_RATE_LIMITER;
  if (!limiter || typeof limiter.limit !== 'function') return json({ error: 'assistant_rate_limiter_unavailable', message: 'L.O.V.E. speech is not configured safely yet.' }, 503);
  const { success } = await limiter.limit({ key: speechRateLimitKey(request) });
  if (!success) return json({ error: 'assistant_speech_rate_limit_exceeded', message: 'Too many speech requests. Try again shortly.' }, 429, { 'retry-after': '30' });

  const body = await request.json().catch(() => null);
  const text = cleanText(body?.text);
  if (!text) return json({ error: 'text_required', message: 'Provide response text to speak.' }, 400);

  const quota = await getAssistantQuota(request, env);
  const capability = loveCapability(quota, env);
  if (!capability.voice_mode) return json({ error: 'voice_not_available', message: 'L.O.V.E. voice is not enabled for this session.', love: capability }, 403);

  try {
    const output = await env.AI.run(LOVE_TTS_MODEL, {
      text,
      speaker: capability.speaker,
      encoding: 'mp3'
    });
    const bytes = await streamOrBufferToBytes(output);
    if (!bytes?.byteLength) return json({ error: 'empty_tts_output', message: 'The speech provider returned no audio.' }, 502);

    return json({
      ok: true,
      text,
      speech: {
        available: true,
        mime_type: 'audio/mpeg',
        audio_base64: bytesToBase64(bytes),
        model: LOVE_TTS_MODEL,
        speaker: capability.speaker,
        source: 'final_response_text'
      },
      love: capability
    });
  } catch (error) {
    console.warn(JSON.stringify({ event: 'assistant_speech_failed', error: safeErrorName(error) }));
    return json({ error: 'tts_unavailable', message: 'L.O.V.E. could not synthesize that reply right now.' }, 503);
  }
}

function cleanText(value) {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, MAX_SPEECH_CHARS) : '';
}

function speechRateLimitKey(request) {
  const ip = (request.headers.get('cf-connecting-ip') || 'anonymous').trim();
  return `assistant-speech:${ip.slice(0, 80)}`;
}

async function streamOrBufferToBytes(value) {
  if (!value) return null;
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (typeof value.arrayBuffer === 'function') return new Uint8Array(await value.arrayBuffer());
  if (typeof value.getReader === 'function') return new Uint8Array(await new Response(value).arrayBuffer());
  return null;
}

function bytesToBase64(bytes) {
  let binary = '';
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  return btoa(binary);
}

function safeErrorName(error) { return error?.name || error?.constructor?.name || 'Error'; }
function json(body, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...extraHeaders } });
}

export const ASSISTANT_SPEECH_LIMITS = Object.freeze({ maxTextChars: MAX_SPEECH_CHARS });
