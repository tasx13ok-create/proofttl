import { getOptionalProofTTLSession } from './auth.js';

const VALID_STATES = new Set(['received', 'scoped', 'payment_ready', 'paid', 'fulfilled', 'cancelled']);
const FACT_AUDIT_PRICE_USD = 1500;

function productionAuthConfigured(env) {
  return Boolean(env?.BETTER_AUTH_SECRET && (env?.PROOFTTL_AUTH_PUBLIC_URL || env?.PROOFTTL_WEB_URL || env?.BETTER_AUTH_URL));
}

function normalizeEmail(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

export async function handleAuditStatus(request, env) {
  if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
  if (!env?.MONITOR_DB) return json({ error: 'audit_intake_storage_unavailable' }, 503);

  const authRequired = productionAuthConfigured(env);
  const session = authRequired ? await getOptionalProofTTLSession(request, env) : null;
  if (authRequired && !session?.user?.id) {
    return json({ error: 'authentication_required', message: 'Sign in to view a ProofTTL audit request.' }, 401);
  }

  let body;
  try { body = await request.json(); } catch { return json({ error: 'invalid_json' }, 400); }
  const id = clean(body?.audit_intake_id, 80);
  const suppliedEmail = normalizeEmail(body?.email);
  if (!/^ati_[a-f0-9]{32}$/.test(id)) return json({ error: 'invalid_status_lookup' }, 400);

  const row = await env.MONITOR_DB.prepare(
    `SELECT id, email, status, offer_type, scoped_price_usd, scope_summary, scope_turnaround,
            payment_url, payment_state, payment_provider, amount_due_usd, prior_credit_usd,
            created_at_ms, scoped_at_ms, paid_at_ms, fulfilled_at_ms
       FROM audit_intakes WHERE id = ? LIMIT 1`
  ).bind(id).first();
  if (!row) return json({ error: 'audit_intake_not_found' }, 404);

  if (session?.user?.id) {
    const linked = await env.MONITOR_DB.prepare(
      'SELECT 1 AS linked FROM account_audit_links WHERE user_id = ? AND intake_id = ? LIMIT 1'
    ).bind(session.user.id, id).first();
    if (!linked?.linked) {
      const sessionEmail = normalizeEmail(session.user.email);
      const intakeEmail = normalizeEmail(row.email);
      if (!sessionEmail || sessionEmail !== intakeEmail) return json({ error: 'audit_intake_not_found' }, 404);
      await env.MONITOR_DB.prepare(
        'INSERT OR IGNORE INTO account_audit_links (user_id,intake_id,created_at) VALUES (?,?,?)'
      ).bind(session.user.id, id, new Date().toISOString()).run();
    }
  } else if (!suppliedEmail || suppliedEmail !== normalizeEmail(row.email)) {
    return json({ error: 'audit_intake_not_found' }, 404);
  }

  return json({
    ok: true,
    audit_intake_id: row.id,
    status: row.status,
    offer_type: 'fact_audit',
    scope: row.scope_summary ? {
      summary: row.scope_summary,
      price_usd: row.scoped_price_usd,
      prior_credit_usd: row.prior_credit_usd || 0,
      amount_due_usd: row.amount_due_usd ?? row.scoped_price_usd,
      turnaround: row.scope_turnaround,
      scoped_at_ms: row.scoped_at_ms
    } : null,
    payment: {
      provider: row.payment_provider || null,
      state: row.payment_state,
      amount_due_usd: row.amount_due_usd ?? null,
      url: row.payment_state === 'ready' ? row.payment_url : null,
      paid_at_ms: row.paid_at_ms
    },
    fulfilled_at_ms: row.fulfilled_at_ms
  });
}

export async function handleAuditAdmin(request, env, pathname) {
  if (!authorized(request, env)) return json({ error: 'admin_auth_required' }, 401);
  if (!env?.MONITOR_DB) return json({ error: 'audit_intake_storage_unavailable' }, 503);

  if (request.method === 'GET' && pathname === '/admin/audit/intakes') {
    const url = new URL(request.url);
    const status = clean(url.searchParams.get('status'), 30) || 'received';
    const limit = Math.min(Math.max(Number(url.searchParams.get('limit')) || 25, 1), 100);
    if (!VALID_STATES.has(status)) return json({ error: 'invalid_status' }, 400);
    const result = await env.MONITOR_DB.prepare(
      `SELECT id, created_at_ms, status, offer_type, email, company_or_project, website_url,
              claim_scope, approximate_claims, why_it_matters, deadline, scoped_price_usd,
              prior_credit_usd, amount_due_usd, scope_summary, scope_turnaround,
              payment_state, payment_provider, payment_url, paid_at_ms, fulfilled_at_ms
         FROM audit_intakes WHERE status = ? ORDER BY created_at_ms ASC LIMIT ?`
    ).bind(status, limit).all();
    return json({ ok: true, status, intakes: result?.results || [] });
  }

  const match = pathname.match(/^\/admin\/audit\/intakes\/(ati_[a-f0-9]{32})\/(scope|upgrade|mark-paid|fulfill|cancel)$/);
  if (!match || request.method !== 'POST') return json({ error: 'not_found' }, 404);
  const [, id, action] = match;

  const existing = await env.MONITOR_DB.prepare(
    `SELECT id, status, offer_type, approximate_claims, scoped_price_usd, prior_credit_usd
       FROM audit_intakes WHERE id = ? LIMIT 1`
  ).bind(id).first();
  if (!existing) return json({ error: 'audit_intake_not_found' }, 404);

  const now = Date.now();
  if (action === 'scope') {
    let body;
    try { body = await request.json(); } catch { return json({ error: 'invalid_json' }, 400); }
    const summary = clean(body?.scope_summary, 5000);
    const turnaround = clean(body?.scope_turnaround, 180);
    const price = Number(body?.price_usd);
    if (!summary || !turnaround || !Number.isInteger(price)) return json({ error: 'invalid_scope' }, 400);
    if (price !== FACT_AUDIT_PRICE_USD) return json({ error: 'fact_audit_price_must_be_1500' }, 400);
    if (!['10-15', '16-25'].includes(existing.approximate_claims)) return json({ error: 'fact_audit_claim_count_out_of_range' }, 409);

    await env.MONITOR_DB.prepare(
      `UPDATE audit_intakes SET status = 'scoped', scope_summary = ?, scoped_price_usd = ?,
       prior_credit_usd = 0, amount_due_usd = ?, scope_turnaround = ?, scoped_at_ms = ?, payment_url = NULL,
       payment_provider = NULL, payment_state = 'not_requested' WHERE id = ?`
    ).bind(summary, FACT_AUDIT_PRICE_USD, FACT_AUDIT_PRICE_USD, turnaround, now, id).run();
    return json({ ok: true, audit_intake_id: id, status: 'scoped', amount_due_usd: FACT_AUDIT_PRICE_USD });
  }

  if (action === 'upgrade') {
    return json({ error: 'offer_upgrade_retired', message: 'ProofTTL now has one flagship $1,500 Fact Audit offer.' }, 410);
  }

  if (action === 'mark-paid') {
    if (!['payment_ready', 'scoped'].includes(existing.status)) return json({ error: 'intake_not_ready_for_payment' }, 409);
    await env.MONITOR_DB.prepare(
      `UPDATE audit_intakes SET status = 'paid', payment_state = 'paid', paid_at_ms = ? WHERE id = ?`
    ).bind(now, id).run();
    return json({ ok: true, audit_intake_id: id, status: 'paid' });
  }

  if (action === 'fulfill') {
    if (existing.status !== 'paid') return json({ error: 'intake_not_paid' }, 409);
    await env.MONITOR_DB.prepare(
      `UPDATE audit_intakes SET status = 'fulfilled', fulfilled_at_ms = ? WHERE id = ?`
    ).bind(now, id).run();
    return json({ ok: true, audit_intake_id: id, status: 'fulfilled' });
  }

  await env.MONITOR_DB.prepare(`UPDATE audit_intakes SET status = 'cancelled' WHERE id = ?`).bind(id).run();
  return json({ ok: true, audit_intake_id: id, status: 'cancelled' });
}

export function auditAdminAuthorized(request, env) { return authorized(request, env); }

function authorized(request, env) {
  const expected = typeof env?.PROOFTTL_ADMIN_TOKEN === 'string' ? env.PROOFTTL_ADMIN_TOKEN.trim() : '';
  if (!expected) return false;
  const header = request.headers.get('authorization') || '';
  return constantTimeEqual(header, `Bearer ${expected}`);
}

function constantTimeEqual(a, b) {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i += 1) mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return mismatch === 0;
}
function clean(value, max) { return typeof value === 'string' ? value.trim().slice(0, max) : ''; }
function json(data, status = 200) { return Response.json(data, { status, headers: { 'cache-control': 'no-store' } }); }
