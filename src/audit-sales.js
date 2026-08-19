const VALID_STATES = new Set(['received', 'scoped', 'payment_ready', 'paid', 'fulfilled', 'cancelled']);

export async function handleAuditStatus(request, env) {
  if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
  if (!env?.MONITOR_DB) return json({ error: 'audit_intake_storage_unavailable' }, 503);

  let body;
  try { body = await request.json(); } catch { return json({ error: 'invalid_json' }, 400); }
  const id = clean(body?.audit_intake_id, 80);
  const email = clean(body?.email, 254).toLowerCase();
  if (!/^ati_[a-f0-9]{32}$/.test(id) || !email) return json({ error: 'invalid_status_lookup' }, 400);

  const row = await env.MONITOR_DB.prepare(
    `SELECT id, status, offer_type, scoped_price_usd, scope_summary, scope_turnaround,
            payment_url, payment_state, created_at_ms, scoped_at_ms, paid_at_ms, fulfilled_at_ms
       FROM audit_intakes WHERE id = ? AND lower(email) = ? LIMIT 1`
  ).bind(id, email).first();

  if (!row) return json({ error: 'audit_intake_not_found' }, 404);
  return json({
    ok: true,
    audit_intake_id: row.id,
    status: row.status,
    offer_type: row.offer_type,
    scope: row.scope_summary ? {
      summary: row.scope_summary,
      price_usd: row.scoped_price_usd,
      turnaround: row.scope_turnaround,
      scoped_at_ms: row.scoped_at_ms
    } : null,
    payment: {
      state: row.payment_state,
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
              scope_summary, scope_turnaround, payment_state, payment_url, paid_at_ms, fulfilled_at_ms
         FROM audit_intakes WHERE status = ? ORDER BY created_at_ms ASC LIMIT ?`
    ).bind(status, limit).all();
    return json({ ok: true, status, intakes: result?.results || [] });
  }

  const match = pathname.match(/^\/admin\/audit\/intakes\/(ati_[a-f0-9]{32})\/(scope|mark-paid|fulfill|cancel)$/);
  if (!match || request.method !== 'POST') return json({ error: 'not_found' }, 404);
  const [, id, action] = match;

  const existing = await env.MONITOR_DB.prepare(
    'SELECT id, status, offer_type, approximate_claims FROM audit_intakes WHERE id = ? LIMIT 1'
  ).bind(id).first();
  if (!existing) return json({ error: 'audit_intake_not_found' }, 404);

  const now = Date.now();
  if (action === 'scope') {
    let body;
    try { body = await request.json(); } catch { return json({ error: 'invalid_json' }, 400); }
    const summary = clean(body?.scope_summary, 5000);
    const turnaround = clean(body?.scope_turnaround, 180);
    const paymentUrl = clean(body?.payment_url, 1000);
    const price = Number(body?.price_usd);
    if (!summary || !turnaround || !Number.isInteger(price) || price < 1 || price > 100000) {
      return json({ error: 'invalid_scope' }, 400);
    }
    if (existing.offer_type === 'stress_test' && price !== 129) return json({ error: 'stress_test_price_must_be_129' }, 400);
    if (existing.offer_type === 'full_audit' && existing.approximate_claims !== '25+' && price !== 500) {
      return json({ error: 'full_audit_price_must_be_500' }, 400);
    }
    if (paymentUrl && !isHttps(paymentUrl)) return json({ error: 'payment_url_must_be_https' }, 400);
    const status = paymentUrl ? 'payment_ready' : 'scoped';
    const paymentState = paymentUrl ? 'ready' : 'not_requested';
    await env.MONITOR_DB.prepare(
      `UPDATE audit_intakes SET status = ?, scope_summary = ?, scoped_price_usd = ?,
       scope_turnaround = ?, scoped_at_ms = ?, payment_url = ?, payment_state = ? WHERE id = ?`
    ).bind(status, summary, price, turnaround, now, paymentUrl || null, paymentState, id).run();
    return json({ ok: true, audit_intake_id: id, status, payment_state: paymentState });
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

  await env.MONITOR_DB.prepare(
    `UPDATE audit_intakes SET status = 'cancelled' WHERE id = ?`
  ).bind(id).run();
  return json({ ok: true, audit_intake_id: id, status: 'cancelled' });
}

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
function isHttps(value) { try { return new URL(value).protocol === 'https:'; } catch { return false; } }
function json(data, status = 200) { return Response.json(data, { status, headers: { 'cache-control': 'no-store' } }); }
