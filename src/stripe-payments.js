const STRIPE_API = 'https://api.stripe.com/v1';
const WEBHOOK_TOLERANCE_SECONDS = 300;

export async function createAuditCheckoutSession(request, env, intakeId) {
  if (!env?.MONITOR_DB) return json({ error: 'audit_intake_storage_unavailable' }, 503);
  const secret = clean(env?.STRIPE_SECRET_KEY, 300);
  if (!secret) return json({ error: 'stripe_not_configured' }, 503);

  const row = await env.MONITOR_DB.prepare(
    `SELECT id, status, offer_type, email, company_or_project, scoped_price_usd,
            scope_summary, scope_turnaround, prior_credit_usd, payment_state,
            stripe_checkout_session_id
       FROM audit_intakes WHERE id = ? LIMIT 1`
  ).bind(intakeId).first();

  if (!row) return json({ error: 'audit_intake_not_found' }, 404);
  if (!['scoped', 'payment_ready'].includes(row.status)) {
    return json({ error: 'audit_intake_not_scoped' }, 409);
  }
  if (!row.scope_summary || !Number.isInteger(Number(row.scoped_price_usd))) {
    return json({ error: 'scope_not_complete' }, 409);
  }

  const total = Number(row.scoped_price_usd);
  const credit = Number(row.prior_credit_usd || 0);
  const amountDue = total - credit;
  if (![129, 371, 500].includes(amountDue)) {
    return json({ error: 'invalid_payment_amount', amount_due_usd: amountDue }, 409);
  }

  const siteUrl = clean(env?.PROOFTTL_WEB_URL, 1000) || 'https://proofttl-web-git-main-tasx13ok-1769s-projects.vercel.app';
  if (!isHttps(siteUrl)) return json({ error: 'invalid_web_url_configuration' }, 503);

  const offerName = amountDue === 371
    ? 'ProofTTL Full Verification Audit Upgrade'
    : row.offer_type === 'stress_test'
      ? 'ProofTTL Claim Stress Test'
      : 'ProofTTL Full Verification Audit';

  const params = new URLSearchParams();
  params.set('mode', 'payment');
  params.set('customer_email', row.email);
  params.set('client_reference_id', row.id);
  params.set('success_url', `${siteUrl.replace(/\/$/, '')}/audit/status/?paid=1`);
  params.set('cancel_url', `${siteUrl.replace(/\/$/, '')}/audit/status/?cancelled=1`);
  params.set('line_items[0][price_data][currency]', 'usd');
  params.set('line_items[0][price_data][unit_amount]', String(amountDue * 100));
  params.set('line_items[0][price_data][product_data][name]', offerName);
  params.set('line_items[0][price_data][product_data][description]', row.scope_summary.slice(0, 500));
  params.set('line_items[0][quantity]', '1');
  params.set('metadata[audit_intake_id]', row.id);
  params.set('metadata[offer_type]', row.offer_type);
  params.set('metadata[amount_due_usd]', String(amountDue));
  params.set('payment_intent_data[metadata][audit_intake_id]', row.id);
  params.set('payment_intent_data[metadata][offer_type]', row.offer_type);
  params.set('payment_intent_data[metadata][amount_due_usd]', String(amountDue));

  const stripeResponse = await fetch(`${STRIPE_API}/checkout/sessions`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${secret}`,
      'content-type': 'application/x-www-form-urlencoded',
      'idempotency-key': `proofttl-audit-${row.id}-${amountDue}`
    },
    body: params.toString()
  });

  const session = await stripeResponse.json().catch(() => ({}));
  if (!stripeResponse.ok || !session?.id || !session?.url) {
    console.error(JSON.stringify({ event: 'stripe_checkout_creation_failed', intake_id: row.id, status: stripeResponse.status }));
    return json({ error: 'stripe_checkout_creation_failed' }, 502);
  }

  const now = Date.now();
  await env.MONITOR_DB.prepare(
    `UPDATE audit_intakes SET status = 'payment_ready', payment_state = 'ready',
       payment_url = ?, payment_provider = 'stripe', amount_due_usd = ?,
       stripe_checkout_session_id = ?, payment_created_at_ms = ? WHERE id = ?`
  ).bind(session.url, amountDue, session.id, now, row.id).run();

  return json({
    ok: true,
    audit_intake_id: row.id,
    payment: {
      provider: 'stripe',
      state: 'ready',
      amount_due_usd: amountDue,
      checkout_url: session.url,
      checkout_session_id: session.id
    }
  }, 201);
}

export async function handleStripeWebhook(request, env) {
  if (!env?.MONITOR_DB) return json({ error: 'audit_intake_storage_unavailable' }, 503);
  const webhookSecret = clean(env?.STRIPE_WEBHOOK_SECRET, 300);
  if (!webhookSecret) return json({ error: 'stripe_webhook_not_configured' }, 503);

  const signature = request.headers.get('stripe-signature') || '';
  const rawBody = await request.text();
  const verified = await verifyStripeSignature(rawBody, signature, webhookSecret);
  if (!verified.ok) return json({ error: verified.error }, 400);

  let event;
  try { event = JSON.parse(rawBody); } catch { return json({ error: 'invalid_json' }, 400); }
  const eventId = clean(event?.id, 200);
  const eventType = clean(event?.type, 160);
  if (!eventId || !eventType) return json({ error: 'invalid_stripe_event' }, 400);

  const duplicate = await env.MONITOR_DB.prepare(
    'SELECT event_id, processed FROM stripe_webhook_events WHERE event_id = ? LIMIT 1'
  ).bind(eventId).first();
  if (duplicate?.processed) return json({ ok: true, duplicate: true });

  const object = event?.data?.object || {};
  const intakeId = clean(object?.metadata?.audit_intake_id || object?.client_reference_id, 80);
  const now = Date.now();

  await env.MONITOR_DB.prepare(
    `INSERT OR IGNORE INTO stripe_webhook_events
       (event_id, event_type, received_at_ms, audit_intake_id, processed)
     VALUES (?, ?, ?, ?, 0)`
  ).bind(eventId, eventType, now, intakeId || null).run();

  if (eventType === 'checkout.session.completed') {
    if (!/^ati_[a-f0-9]{32}$/.test(intakeId)) return json({ error: 'missing_audit_intake_metadata' }, 400);
    if (object.payment_status !== 'paid') {
      return json({ ok: true, ignored: 'checkout_session_not_paid' });
    }

    const expected = await env.MONITOR_DB.prepare(
      `SELECT id, status, amount_due_usd, stripe_checkout_session_id
         FROM audit_intakes WHERE id = ? LIMIT 1`
    ).bind(intakeId).first();
    if (!expected) return json({ error: 'audit_intake_not_found' }, 404);
    if (expected.stripe_checkout_session_id && expected.stripe_checkout_session_id !== object.id) {
      return json({ error: 'stripe_session_mismatch' }, 409);
    }
    const paidUsd = Number(object.amount_total || 0) / 100;
    if (Number(expected.amount_due_usd || 0) !== paidUsd) {
      return json({ error: 'stripe_amount_mismatch' }, 409);
    }

    await env.MONITOR_DB.prepare(
      `UPDATE audit_intakes SET status = 'paid', payment_state = 'paid', paid_at_ms = ?,
       stripe_payment_intent_id = ?, stripe_last_event_id = ? WHERE id = ?`
    ).bind(now, clean(object.payment_intent, 200) || null, eventId, intakeId).run();
  }

  await env.MONITOR_DB.prepare(
    'UPDATE stripe_webhook_events SET processed = 1 WHERE event_id = ?'
  ).bind(eventId).run();

  return json({ ok: true });
}

export async function verifyStripeSignature(payload, header, secret, nowSeconds = Math.floor(Date.now() / 1000)) {
  const parts = header.split(',').map((part) => part.trim());
  const timestamp = parts.find((part) => part.startsWith('t='))?.slice(2);
  const signatures = parts.filter((part) => part.startsWith('v1=')).map((part) => part.slice(3));
  if (!timestamp || !signatures.length || !/^\d+$/.test(timestamp)) return { ok: false, error: 'invalid_stripe_signature' };

  const ts = Number(timestamp);
  if (Math.abs(nowSeconds - ts) > WEBHOOK_TOLERANCE_SECONDS) {
    return { ok: false, error: 'stripe_signature_too_old' };
  }

  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const digest = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${timestamp}.${payload}`));
  const expected = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  const valid = signatures.some((candidate) => constantTimeEqual(candidate, expected));
  return valid ? { ok: true } : { ok: false, error: 'invalid_stripe_signature' };
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
