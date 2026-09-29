import { validatePublicSourceUrl } from '../security.js';
import { sha256 } from '../audits/integrity.js';
import { AuditError, requireCondition, checkSignal } from '../audits/errors.js';

const MAX_BYTES = 100000;
const SECRET = /(?:\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}|\bgh[pousr]_[A-Za-z0-9]{20,}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\b(?:api[_ -]?key|access[_ -]?token|password|authorization)\s*[:=]\s*["']?[A-Za-z0-9_+\/-]{16,})/i;
export function rejectSecrets(value) {
  requireCondition(!SECRET.test(value), 'source_contains_secret');
}
export function normalizeText(text) {
  requireCondition(typeof text === 'string' && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2060-\u206f]/u.test(text), 'unsafe_text_controls');
  requireCondition(!/[\ud800-\udfff]/u.test(text), 'invalid_unicode_text');
  return text.normalize('NFC').replace(/\s+/gu, ' ').trim();
}
function extractPlain(bytes) {
  requireCondition(bytes.byteLength <= MAX_BYTES, 'source_too_large', 413);
  let text;
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
  catch { throw new AuditError('source_invalid_utf8'); }
  requireCondition(!/^\s*(?:%PDF-|PK\x03\x04|\{(?:\s*["}]|$)|\[|<\/?[A-Za-z!])/u.test(text) && !/<\/?(?:html|script|style|iframe|div|span)\b/i.test(text), 'source_mime_mismatch');
  rejectSecrets(text);
  return normalizeText(text);
}
async function readBytes(response, signal) {
  const declared = Number(response.headers.get('content-length'));
  requireCondition(!Number.isFinite(declared) || declared <= MAX_BYTES, 'source_too_large', 413);
  const reader = response.body?.getReader();
  requireCondition(reader, 'source_empty');
  const chunks = []; let size = 0;
  try {
    while (true) {
      checkSignal(signal);
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      requireCondition(size <= MAX_BYTES, 'source_too_large', 413);
      chunks.push(value);
    }
  } finally { await reader.cancel().catch(() => {}); }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes;
}
function exactKeys(source, allowed) {
  requireCondition(source && typeof source === 'object' && !Array.isArray(source), 'invalid_source');
  requireCondition(Object.keys(source).every(key => allowed.includes(key)), 'unexpected_source_field');
}
export async function ingestSources(inputs, policy, { signal } = {}) {
  requireCondition(['customer_only', 'customer_plus_public', 'public_only'].includes(policy), 'invalid_source_policy');
  requireCondition(Array.isArray(inputs) && inputs.length <= 20, 'invalid_sources');
  const sources = []; const seen = new Set(); let totalBytes = 0;
  for (const input of inputs) {
    checkSignal(signal);
    requireCondition(input && typeof input === 'object', 'invalid_source');
    let bytes, canonicalUrl = null;
    if (input.kind === 'text') {
      exactKeys(input, ['kind', 'text', 'label']);
      requireCondition(policy !== 'public_only', 'public_only_requires_url_sources');
      requireCondition(typeof input.text === 'string', 'source_text_required');
      normalizeText(input.text);
      bytes = new TextEncoder().encode(input.text);
    } else if (input.kind === 'file') {
      exactKeys(input, ['kind', 'content_base64', 'mime_type', 'filename', 'label']);
      requireCondition(policy !== 'public_only', 'public_only_requires_url_sources');
      requireCondition(input.mime_type === 'text/plain', 'unsupported_source_mime');
      requireCondition(typeof input.content_base64 === 'string' && input.content_base64.length <= 133336 && /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(input.content_base64), 'invalid_file_base64');
      const binary = atob(input.content_base64);
      requireCondition(btoa(binary) === input.content_base64, 'noncanonical_file_base64');
      bytes = Uint8Array.from(binary, ch => ch.charCodeAt(0));
    } else if (input.kind === 'url') {
      exactKeys(input, ['kind', 'url', 'label']);
      let url; try { url = new URL(input.url); } catch { throw new AuditError('invalid_source_url'); }
      requireCondition(url.protocol === 'https:' && !url.search && !url.hash && !url.username && !url.password, 'source_url_must_be_public_https_without_credentials_or_query');
      rejectSecrets(url.href);
      requireCondition(!url.pathname.split('/').some(part => part.length > 100), 'source_url_transient_path_not_supported');
      const safety = await validatePublicSourceUrl(url);
      requireCondition(safety.ok, safety.reason || 'source_url_not_allowed');
      checkSignal(signal);
      const timeoutSignal = AbortSignal.timeout(10000);
      const fetchSignal = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;
      let response;
      try { response = await fetch(url.href, { redirect: 'manual', signal: fetchSignal, headers: { Accept: 'text/plain', 'User-Agent': 'ProofTTL/canonical-audit-v1' } }); }
      catch { throw new AuditError('source_fetch_failed', 422); }
      requireCondition(response.ok && response.status !== 206, 'source_http_failure', 422);
      requireCondition((response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase() === 'text/plain', 'unsupported_source_mime');
      requireCondition(!response.headers.get('content-encoding') || response.headers.get('content-encoding') === 'identity', 'compressed_source_not_supported');
      bytes = await readBytes(response, fetchSignal);
      canonicalUrl = url.href;
    } else throw new AuditError('unsupported_source_kind');
    totalBytes += bytes.byteLength;
    requireCondition(totalBytes <= 500000, 'source_corpus_too_large', 413);
    const text = extractPlain(bytes);
    const rawHash = await sha256(bytes);
    if (seen.has(rawHash)) continue;
    seen.add(rawHash);
    const label = input.label || input.filename || 'Supplied source';
    requireCondition(typeof label === 'string' && label.length <= 300, 'invalid_source_label');
    rejectSecrets(label); normalizeText(label);
    const textHash = await sha256(text);
    sources.push({
      source_id: 'src_' + rawHash.slice(7),
      kind: input.kind, origin: policy === 'public_only' ? 'public' : 'customer',
      label, content_type: 'text/plain', canonical_url: canonicalUrl,
      observed_at: new Date().toISOString(), sha256: rawHash,
      extracted_text_sha256: textHash, snapshot_mode: 'immutable',
      monitorable: input.kind === 'url', extracted_text: text,
      raw_content_base64: btoa(Array.from(bytes, byte => String.fromCharCode(byte)).join(''))
    });
  }
  return sources;
}
export function publicSource(source) {
  const { extracted_text, raw_content_base64, ...metadata } = source;
  return metadata;
}
