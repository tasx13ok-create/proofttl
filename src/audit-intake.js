import { getOptionalProofTTLSession } from './auth.js';

const OFFERS = {
  stress_test: {
    name: 'ProofTTL Claim Stress Test',
    price_usd: 129,
    included_claims: '3-5',
    turnaround: '48 hours after payment and scope confirmation',
    monitoring_days: 0,
    upgrade_credit_usd: 129
  },
  full_audit: {
    name: 'ProofTTL Verification Audit',
    price_usd: 500,
    included_claims: '10-25',
    turnaround: '3-5 business days after payment and scope confirmation',
    monitoring_days: 7,
    upgrade_credit_usd: 0
  }
};
const CLAIM_BUCKETS = {
  stress_test: new Set(['3-5']),
  full_audit: new Set(['10-15', '16-25', '25+'])
};
const WINDOW_MS = 10 * 60 * 1000;
const MAX_PER_WINDOW = 3;

export async function handleAuditIntake(request, env) {
  if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
  if (!env?.MONITOR_DB) return json({ error: 'audit_intake_storage_unavailable' }, 503);

  const contentType = request.headers.get('content-type') || '';
  if (!contentType.toLowerCase().includes('application/json')) return json({ error: 'content_type_must_be_application_json' }, 415);

  let body;
  try {
    const raw = await request.text();
    if (raw.length > 12000) return json({ error: 'request_too_large' }, 413);
    body = JSON.parse(raw);
  } catch { return json({ error: 'invalid_json' }, 400); }

  if (typeof body?.company_site === 'string' && body.company_site.trim()) return json({ ok: true, status: 'received' });

  const offerType = clean(body?.offer_type, 30) || 'full_audit';
  const offer = OFFERS[offerType];
  const email = clean(body?.email, 254).toLowerCase();
  const companyOrProject = clean(body?.company_or_project, 160);
  const websiteUrl = clean(body?.website_url, 600);
  const claimScope = clean(body?.claim_scope, 4000);
  const approximateClaims = clean(body?.approximate_claims, 20);
  const whyItMatters = clean(body?.why_it_matters, 2500);
  const deadline = clean(body?.deadline, 120);

  if (!offer) return json({ error: 'invalid_offer_type' }, 400);
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ error: 'valid_email_required' }, 400);
  if (!companyOrProject) return json({ error: 'company_or_project_required' }, 400);
  if (!claimScope) return json({ error: 'claim_scope_required' }, 400);
  if (!whyItMatters) return json({ error: 'why_it_matters_required' }, 400);
  if (!CLAIM_BUCKETS[offerType].has(approximateClaims)) return json({ error: 'invalid_claim_count_for_offer' }, 400);

  if (websiteUrl) {
    try { const parsed = new URL(websiteUrl); if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('bad protocol'); }
    catch { return json({ error: 'invalid_website_url' }, 400); }
  }

  const now = Date.now();
  const fingerprint = await requestFingerprint(request);
  const recent = await env.MONITOR_DB.prepare('SELECT COUNT(*) AS count FROM audit_intakes WHERE request_fingerprint = ? AND created_at_ms >= ?').bind(fingerprint, now - WINDOW_MS).first();
  if (Number(recent?.count || 0) >= MAX_PER_WINDOW) return json({ error: 'audit_intake_rate_limited', retry_after_seconds: 600 }, 429, { 'retry-after': '600' });

  const id = `ati_${crypto.randomUUID().replaceAll('-', '')}`;
  await env.MONITOR_DB.prepare(
    `INSERT INTO audit_intakes (
      id, created_at_ms, status, email, company_or_project, website_url,
      claim_scope, approximate_claims, why_it_matters, deadline, request_fingerprint,
      offer_type
    ) VALUES (?, ?, 'received', ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(id, now, email, companyOrProject, websiteUrl || null, claimScope, approximateClaims, whyItMatters, deadline || null, fingerprint, offerType).run();

  let linkedToAccount = false;
  try {
    const session = await getOptionalProofTTLSession(request, env);
    const sessionUserId = session?.user?.id;
    const sessionEmail = typeof session?.user?.email === 'string' ? session.user.email.trim().toLowerCase() : '';
    if (sessionUserId && sessionEmail && sessionEmail === email) {
      await env.MONITOR_DB.prepare('INSERT OR IGNORE INTO account_audit_links (user_id,intake_id,created_at) VALUES (?,?,?)')
        .bind(sessionUserId, id, new Date(now).toISOString()).run();
      linkedToAccount = true;
    }
  } catch (error) {
    console.warn(JSON.stringify({ event: 'audit_account_auto_link_failed', intake_id: id, error: error?.name || 'Error' }));
  }

  return json({
    ok: true,
    audit_intake_id: id,
    status: 'received',
    account: { linked: linkedToAccount },
    offer: {
      type: offerType,
      ...offer,
      upgrade: offerType === 'stress_test' ? { to: 'full_audit', additional_usd: 371, total_usd: 500 } : null
    },
    payment: { required_now: false, state: 'scope_review_before_payment' },
    next_step: 'ProofTTL reviews the submitted scope within 24 hours before payment is requested.'
  }, 201);
}

function clean(value, max) { return typeof value === 'string' ? value.trim().slice(0, max) : ''; }
async function requestFingerprint(request) {
  const ip = request.headers.get('cf-connecting-ip') || request.headers.get('x-forwarded-for') || 'unknown';
  const ua = request.headers.get('user-agent') || 'unknown';
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${ip}|${ua}`));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}
function json(data, status = 200, extraHeaders = {}) { return Response.json(data, { status, headers: { 'cache-control': 'no-store', ...extraHeaders } }); }
