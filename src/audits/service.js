import { deterministicCheck, verificationContextRisks } from '../index.js';
import { ingestSources, normalizeText, publicSource, rejectSecrets } from '../sources/ingest.js';
import { canonicalizeJson, objectHash, sha256 } from './integrity.js';
import { AuditError, requireCondition, checkSignal } from './errors.js';
export { AuditError };

const VERSION = 'canonical-audit-v1';
const AUDIT_VALID_MS = 15 * 60 * 1000;
const RETENTION_MS = 30 * 86400000;
const RANK = { low: 0, medium: 1, high: 2, critical: 3 };
const id = prefix => prefix + crypto.randomUUID().replaceAll('-', '');
const stamp = ms => new Date(ms).toISOString();
function exactKeys(args, allowed, required) {
  requireCondition(args && typeof args === 'object' && !Array.isArray(args), 'invalid_arguments');
  requireCondition(Object.keys(args).every(key => allowed.includes(key)), 'unexpected_argument');
  requireCondition(required.every(key => args[key] !== undefined), 'missing_argument');
}
function consequence(claim, hint = 'medium') {
  requireCondition(Object.hasOwn(RANK, hint), 'invalid_consequence');
  const inferred = /\b(?:dosage|medication|diagnosis|treatment|vaccine|mortality|pregnant|legal|statutory|tax|investment|financial|stock|encryption|password|security|safety|revenue|profit)\b/i.test(claim) ? 'high' : 'medium';
  return RANK[hint] > RANK[inferred] ? hint : inferred;
}
function atomic(claim) {
  return !/\b(?:and|but|whereas|although)\b|;/i.test(claim) &&
    !/^(?:it|they|this|that|these|those|he|she|please|delete|create|ignore|disregard|return|mark|set|use|run|audit)\b/i.test(claim) &&
    !/\?$/.test(claim) &&
    /[\p{L}]/u.test(claim);
}
async function evaluate(claim, sources, hint, asOf) {
  const normalized = normalizeText(claim);
  requireCondition(normalized.length > 0 && normalized.length <= 4000, 'claim_required_or_too_long');
  rejectSecrets(normalized);
  const risk = consequence(normalized, hint);
  const reasons = []; const evidence = []; const conflicts = [];
  const isAtomic = atomic(normalized);
  if (!isAtomic) reasons.push('non_atomic_or_context_dependent_claim');
  const temporalUnproven = Boolean(asOf && Math.abs(Date.parse(asOf) - Date.now()) > 60000);
  if (temporalUnproven) reasons.push('historical_or_future_as_of_not_proven');
  let supporting = 0;
  for (const source of sources) {
    const risks = verificationContextRisks(normalized, source.extracted_text);
    const result = deterministicCheck(normalized, source.extracted_text);
    if (result?.status === 'SUPPORTED' && risks.length === 0) {
      supporting++;
      // Bind offsets to the complete normalized source, never to a model excerpt.
      const start = source.extracted_text.indexOf(normalized);
      if (start >= 0) {
        const excerpt = source.extracted_text.slice(start, start + normalized.length);
        evidence.push({
          source_id: source.source_id, start, end: start + normalized.length,
          offset_unit: 'utf16_normalized_text', text: excerpt, sha256: await sha256(excerpt),
          source_sha256: source.sha256, extracted_text_sha256: source.extracted_text_sha256
        });
      }
    } else {
      conflicts.push({ source_id: source.source_id, type: risks.length ? 'context_risk' : 'support_not_established', reasons: risks.length ? risks : ['no_guarded_exact_entailment'] });
    }
  }
  // No semantic/model/world-knowledge fallback on the canonical customer path.
  // Every supplied source must pass: unparsed disagreement/qualification stays UNKNOWN.
  const supported = isAtomic && !temporalUnproven && sources.length > 0 && supporting === sources.length && evidence.length === sources.length;
  if (!sources.length) reasons.push('missing_evidence');
  if (!supported) reasons.push('insufficient_unambiguous_attributable_evidence');
  const eligible = supported && RANK[risk] < RANK.high;
  if (supported && !eligible) reasons.push('high_consequence_challenge_not_proven');
  return {
    claim_result_id: id('acr_'), claim: normalized,
    verdict: supported ? 'SUPPORTED' : 'UNKNOWN', reasons, evidence, conflicts,
    consequence: risk, lease_eligible: eligible,
    verifier: { version: VERSION, method: 'guarded_exact_entailment', semantic_verification: 'NOT SUPPORTED' },
    challenge: { state: 'COMPLETED', method: 'complete_supplied_corpus_context_scan', outside_evidence_used: false, high_consequence_independent_challenge: 'NOT PROVEN' }
  };
}
function database(context) {
  requireCondition(typeof context?.tenantId === 'string' && context.tenantId.length >= 1 && context.tenantId.length <= 200, 'tenant_required', 401);
  requireCondition(context?.env?.MONITOR_DB?.prepare, 'audit_storage_not_configured', 503);
  return context.env.MONITOR_DB;
}
function publicAudit(audit) {
  const { tenant_id, ...publicFields } = audit;
  return { ...publicFields, sources: audit.sources.map(publicSource) };
}
async function validateSnapshots(audit) {
  for (const source of audit.sources) {
    let raw;
    try { raw = Uint8Array.from(atob(source.raw_content_base64), ch => ch.charCodeAt(0)); }
    catch { throw new AuditError('source_snapshot_integrity_failed', 409); }
    requireCondition(await sha256(raw) === source.sha256, 'source_snapshot_integrity_failed', 409);
    requireCondition(await sha256(source.extracted_text) === source.extracted_text_sha256, 'source_snapshot_integrity_failed', 409);
    let decoded; try { decoded = new TextDecoder('utf-8', { fatal: true }).decode(raw); } catch { throw new AuditError('source_snapshot_integrity_failed', 409); }
    requireCondition(normalizeText(decoded) === source.extracted_text, 'source_snapshot_integrity_failed', 409);
  }
  for (const result of audit.claim_results) {
    for (const span of result.evidence) {
      const source = audit.sources.find(item => item.source_id === span.source_id);
      requireCondition(source && Number.isInteger(span.start) && Number.isInteger(span.end) && span.start >= 0 && span.end > span.start && span.end <= source.extracted_text.length &&
        source.extracted_text.slice(span.start, span.end) === span.text && await sha256(span.text) === span.sha256 &&
        span.source_sha256 === source.sha256 && span.extracted_text_sha256 === source.extracted_text_sha256, 'evidence_binding_integrity_failed', 409);
    }
  }
}
async function loadAudit(auditId, context, allowExpired = false) {
  requireCondition(/^aud_[a-f0-9]{32}$/.test(auditId), 'invalid_audit_id');
  const row = await database(context).prepare('SELECT payload_json, payload_sha256, expires_at FROM verification_audits WHERE tenant_id = ? AND audit_id = ?').bind(context.tenantId, auditId).first();
  requireCondition(row, 'audit_not_found', 404);
  let audit; try { audit = JSON.parse(row.payload_json); } catch { throw new AuditError('audit_integrity_failed', 409); }
  requireCondition(audit.audit_id === auditId && audit.tenant_id === context.tenantId && await objectHash(audit) === row.payload_sha256 &&
    audit.expires_at === row.expires_at, 'audit_integrity_failed', 409);
  requireCondition(allowExpired || Date.parse(audit.expires_at) > Date.now(), 'audit_expired', 409);
  await validateSnapshots(audit);
  return audit;
}
function selectResult(audit, resultId) {
  requireCondition(/^acr_[a-f0-9]{32}$/.test(resultId), 'invalid_claim_result_id');
  const result = audit.claim_results.find(item => item.claim_result_id === resultId);
  requireCondition(result, 'claim_result_not_found', 404);
  return result;
}
function extractOutput(output) {
  // Bounded conservative sentence/clause extraction. Do not invent omitted subjects.
  return output.split(/(?<=[.!?])\s+|[\r\n]+|;\s*/u).map(text => text.trim()).filter(Boolean);
}
async function auditInput(name, args, context) {
  const allowed = name === 'audit_claim'
    ? ['claim', 'sources', 'source_policy', 'as_of', 'consequence']
    : ['output_text', 'sources', 'source_policy', 'max_claims', 'consequence_threshold'];
  exactKeys(args, allowed, [name === 'audit_claim' ? 'claim' : 'output_text', 'sources', 'source_policy']);
  database(context);
  const input = name === 'audit_claim' ? args.claim : args.output_text;
  requireCondition(typeof input === 'string' && input.trim() && input.length <= (name === 'audit_claim' ? 4000 : 50000), 'invalid_audit_input');
  normalizeText(input); rejectSecrets(input);
  if (args.as_of !== undefined) requireCondition(typeof args.as_of === 'string' && Number.isFinite(Date.parse(args.as_of)), 'invalid_as_of');
  const maxClaims = args.max_claims ?? 25;
  requireCondition(Number.isInteger(maxClaims) && maxClaims >= 1 && maxClaims <= 100, 'invalid_max_claims');
  const threshold = args.consequence_threshold || 'medium';
  requireCondition(Object.hasOwn(RANK, threshold), 'invalid_consequence_threshold');
  const sources = await ingestSources(args.sources, args.source_policy, context);
  const candidates = name === 'audit_claim' ? [input] : extractOutput(input);
  const results = []; const omitted = []; const extracted = [];
  for (const candidate of candidates) {
    const risk = consequence(candidate, args.consequence || 'medium');
    const item = { claim: candidate, consequence: risk, atomic: atomic(candidate) };
    extracted.push(item);
    if (candidate.length > 4000) { omitted.push({ ...item, reason: 'claim_too_long' }); continue; }
    if (name === 'audit_output' && RANK[risk] < RANK[threshold]) { omitted.push({ ...item, reason: 'below_consequence_threshold' }); continue; }
    if (results.length >= maxClaims) { omitted.push({ ...item, reason: 'max_claims' }); continue; }
    checkSignal(context.signal);
    results.push(await evaluate(candidate, sources, args.consequence || 'medium', args.as_of));
  }
  const now = Date.now();
  const audit = {
    audit_id: id('aud_'), tenant_id: context.tenantId, source_policy: args.source_policy,
    input_hash: await objectHash({ tool: name, ...args }), created_at: stamp(now),
    expires_at: stamp(now + AUDIT_VALID_MS), verifier_version: VERSION,
    sources, claim_results: results, extracted_claims: extracted, omitted_claims: omitted,
    extraction: { method: name === 'audit_claim' ? 'supplied_atomic_claim' : 'deterministic_sentence_clause', recall: 'NOT PROVEN', compound_claims_lease_ineligible: true },
    public_discovery: 'NOT SUPPORTED', outside_evidence_used: false,
    summary: { supported: results.filter(x => x.verdict === 'SUPPORTED').length, unknown: results.filter(x => x.verdict === 'UNKNOWN').length, omitted: omitted.length }
  };
  const payload = canonicalizeJson(audit);
  requireCondition(new TextEncoder().encode(payload).byteLength <= 1500000, 'audit_record_too_large', 413);
  const payloadHash = await objectHash(audit);
  checkSignal(context.signal);
  await database(context).prepare('INSERT INTO verification_audits (tenant_id, audit_id, created_at, expires_at, retain_until, payload_json, payload_sha256) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .bind(context.tenantId, audit.audit_id, audit.created_at, audit.expires_at, stamp(now + RETENTION_MS), payload, payloadHash).run();
  const out = publicAudit(audit);
  if (name === 'audit_claim') return { ...out, ...results[0], source_ids: sources.map(x => x.source_id), observed_at: audit.created_at };
  return out;
}
function attestation(lease) {
  const fields = ['lease_id', 'audit_id', 'claim_result_id', 'claim', 'issued_status', 'source_policy', 'sources', 'evidence', 'observed_at', 'issued_at', 'expires_at', 'ttl_seconds', 'verifier_version', 'verification_method', 'issued_lease_state', 'monitoring'];
  return { attestation_version: 'proofttl-issuance-v2', ...Object.fromEntries(fields.map(key => [key, lease[key]])) };
}
export async function verifyFactLeaseSignature(lease, publicJwk) {
  try {
    if (!lease.signature || lease.signature.algorithm !== 'Ed25519' || lease.signature.version !== 'proofttl-ed25519-v2' || canonicalizeJson(attestation(lease)) !== canonicalizeJson(lease.issued_attestation)) return false;
    const key = await crypto.subtle.importKey('jwk', publicJwk, { name: 'Ed25519' }, false, ['verify']);
    const raw = lease.signature.value.replaceAll('-', '+').replaceAll('_', '/');
    const bytes = Uint8Array.from(atob(raw + '='.repeat((4 - raw.length % 4) % 4)), ch => ch.charCodeAt(0));
    return await crypto.subtle.verify('Ed25519', key, bytes, new TextEncoder().encode(canonicalizeJson(lease.issued_attestation)));
  } catch { return false; }
}
async function signLease(lease, env) {
  requireCondition(env.PROOFTTL_SIGNING_PRIVATE_JWK, 'lease_signing_not_configured', 503);
  let jwk; try { jwk = typeof env.PROOFTTL_SIGNING_PRIVATE_JWK === 'string' ? JSON.parse(env.PROOFTTL_SIGNING_PRIVATE_JWK) : env.PROOFTTL_SIGNING_PRIVATE_JWK; }
  catch { throw new AuditError('lease_signing_configuration_invalid', 503); }
  requireCondition(jwk.kty === 'OKP' && jwk.crv === 'Ed25519' && jwk.d && jwk.x, 'lease_signing_configuration_invalid', 503);
  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'Ed25519' }, false, ['sign']);
  lease.issued_attestation = attestation(lease);
  const signed = new Uint8Array(await crypto.subtle.sign('Ed25519', key, new TextEncoder().encode(canonicalizeJson(lease.issued_attestation))));
  lease.signature = {
    version: 'proofttl-ed25519-v2', algorithm: 'Ed25519',
    key_id: env.PROOFTTL_SIGNING_KEY_ID || 'proofttl-vnext',
    signed_payload: 'issued_attestation',
    value: btoa(Array.from(signed, byte => String.fromCharCode(byte)).join('')).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, ''),
    public_key_jwk: { kty: 'OKP', crv: 'Ed25519', x: jwk.x }
  };
  return lease;
}
async function leaseResponse(row, context) {
  let lease; try { lease = JSON.parse(row.payload_json); } catch { throw new AuditError('lease_integrity_failed', 409); }
  let signingKey;
  try { signingKey = typeof context.env.PROOFTTL_SIGNING_PRIVATE_JWK === 'string' ? JSON.parse(context.env.PROOFTTL_SIGNING_PRIVATE_JWK) : context.env.PROOFTTL_SIGNING_PRIVATE_JWK; } catch {}
  requireCondition(signingKey?.x && await verifyFactLeaseSignature(lease, { kty: 'OKP', crv: 'Ed25519', x: signingKey.x }), 'lease_integrity_failed', 409);
  return { ...lease, current_status: lease.issued_status, lease_state: Date.parse(lease.expires_at) <= Date.now() ? 'EXPIRED' : 'ACTIVE', signature_verified: true, revocation: null, current_status_basis: 'IMMUTABLE_SNAPSHOT' };
}
async function createLease(args, context) {
  exactKeys(args, ['audit_id', 'claim_result_id', 'ttl_seconds', 'idempotency_key'], ['audit_id', 'claim_result_id', 'ttl_seconds', 'idempotency_key']);
  requireCondition(Number.isInteger(args.ttl_seconds) && args.ttl_seconds >= 60 && args.ttl_seconds <= 604800, 'invalid_ttl');
  requireCondition(typeof args.idempotency_key === 'string' && /^[A-Za-z0-9_.:-]{8,200}$/.test(args.idempotency_key), 'invalid_idempotency_key');
  const db = database(context);
  const keyHash = await sha256(args.idempotency_key);
  const requestHash = await objectHash({ audit_id: args.audit_id, claim_result_id: args.claim_result_id, ttl_seconds: args.ttl_seconds });
  const existing = await db.prepare('SELECT payload_json, request_sha256 FROM verification_leases WHERE tenant_id = ? AND idempotency_sha256 = ?').bind(context.tenantId, keyHash).first();
  if (existing) {
    requireCondition(existing.request_sha256 === requestHash, 'idempotency_key_conflict', 409);
    return leaseResponse(existing, context);
  }
  const audit = await loadAudit(args.audit_id, context);
  const result = selectResult(audit, args.claim_result_id);
  requireCondition(result.verdict === 'SUPPORTED' && result.lease_eligible && result.evidence.length > 0 && result.conflicts.length === 0, 'audit_result_not_lease_eligible', 409);
  // Re-evaluate the stored complete corpus rather than accepting serialized eligibility alone.
  const fresh = await evaluate(result.claim, audit.sources, result.consequence, undefined);
  requireCondition(fresh.verdict === 'SUPPORTED' && fresh.lease_eligible, 'audit_result_no_longer_eligible', 409);
  const now = Date.now();
  const lease = {
    lease_id: id('ftl_'), audit_id: audit.audit_id, claim_result_id: result.claim_result_id,
    claim: result.claim, issued_status: result.verdict, source_policy: audit.source_policy,
    sources: audit.sources.map(publicSource), evidence: result.evidence,
    observed_at: audit.created_at, issued_at: stamp(now), expires_at: stamp(now + args.ttl_seconds * 1000),
    ttl_seconds: args.ttl_seconds, verifier_version: audit.verifier_version,
    verification_method: 'guarded_exact_entailment', issued_lease_state: 'ACTIVE',
    monitoring: { status: 'NOT_REGISTERED', monitorable: audit.sources.every(source => source.monitorable), verification_basis: 'IMMUTABLE_SNAPSHOT', snapshot_bound: true }
  };
  checkSignal(context.signal);
  await signLease(lease, context.env);
  checkSignal(context.signal);
  // Single atomic D1 insert + unique tenant/key constraint resolves concurrent retries.
  await db.prepare('INSERT INTO verification_leases (tenant_id, lease_id, audit_id, claim_result_id, idempotency_sha256, request_sha256, payload_json, retain_until) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (tenant_id, idempotency_sha256) DO NOTHING')
    .bind(context.tenantId, lease.lease_id, audit.audit_id, result.claim_result_id, keyHash, requestHash, canonicalizeJson(lease), stamp(now + RETENTION_MS)).run();
  const winner = await db.prepare('SELECT payload_json, request_sha256 FROM verification_leases WHERE tenant_id = ? AND idempotency_sha256 = ?').bind(context.tenantId, keyHash).first();
  requireCondition(winner && winner.request_sha256 === requestHash, 'idempotency_key_conflict', 409);
  return leaseResponse(winner, context);
}
export async function pruneCanonicalAudits(env, now = Date.now()) {
  if (!env.MONITOR_DB?.prepare) return { deleted: 0 };
  const results = await env.MONITOR_DB.batch([
    env.MONITOR_DB.prepare('DELETE FROM verification_leases WHERE retain_until <= ?').bind(stamp(now)),
    env.MONITOR_DB.prepare('DELETE FROM verification_audits WHERE retain_until <= ? AND NOT EXISTS (SELECT 1 FROM verification_leases WHERE verification_leases.tenant_id = verification_audits.tenant_id AND verification_leases.audit_id = verification_audits.audit_id)').bind(stamp(now))
  ]);
  return { deleted: results.reduce((sum, row) => sum + (row.meta?.changes || 0), 0) };
}
export async function executeTool(name, args, context) {
  database(context); checkSignal(context.signal);
  if (name === 'audit_claim' || name === 'audit_output') return auditInput(name, args, context);
  if (name === 'create_fact_lease') return createLease(args, context);
  if (name === 'get_fact_lease') {
    exactKeys(args, ['lease_id'], ['lease_id']);
    requireCondition(/^ftl_[a-f0-9]{32}$/.test(args.lease_id), 'invalid_lease_id');
    const row = await database(context).prepare('SELECT payload_json FROM verification_leases WHERE tenant_id = ? AND lease_id = ?').bind(context.tenantId, args.lease_id).first();
    requireCondition(row, 'lease_not_found', 404);
    const response = await leaseResponse(row, context);
    requireCondition(response.lease_id === args.lease_id, 'lease_integrity_failed', 409);
    return response;
  }
  if (name === 'challenge_claim' || name === 'compare_evidence') {
    exactKeys(args, ['audit_id', 'claim_result_id'], name === 'challenge_claim' ? ['audit_id', 'claim_result_id'] : ['audit_id']);
    const audit = await loadAudit(args.audit_id, context);
    const results = args.claim_result_id ? [selectResult(audit, args.claim_result_id)] : audit.claim_results;
    if (name === 'compare_evidence') return { audit_id: audit.audit_id, source_policy: audit.source_policy, sources: audit.sources.map(publicSource), claim_results: results, method: 'complete_supplied_corpus_comparison', semantic_scope_reconciliation: 'NOT PROVEN', outside_evidence_used: false };
    const result = results[0];
    const challenged = await evaluate(result.claim, audit.sources, result.consequence, undefined);
    return { audit_id: audit.audit_id, claim_result_id: result.claim_result_id, verdict: challenged.verdict, evidence: challenged.evidence, conflicts: challenged.conflicts, reasons: challenged.reasons, lease_eligible: result.lease_eligible && challenged.lease_eligible, challenge: challenged.challenge, audit_mutated: false };
  }
  throw new AuditError('tool_not_found', 404);
}
