const STRIPE_API = 'https://api.stripe.com/v1';
const WEBHOOK_TOLERANCE_SECONDS = 300;
const FACT_AUDIT_PRICE_USD = 1500;

export async function createAuditCheckoutSession(request, env, intakeId) {
  if (!env?.MONITOR_DB) return json({ error: 'audit_intake_storage_unavailable' }, 503);
  const secret = clean(env?.STRIPE_SECRET_KEY, 300);
  if (!secret) return json({ error: 'stripe_not_configured' }, 503);

  const row = await env.MONITOR_DB.prepare(
    `SELECT id, status, offer_type, email, company_or_project, scoped_price_usd,
            scope_summary, scope_turnaround, prior_credit_usd, amount_due_usd,
            payment_state, payment_url, payment_created_at_ms, stripe_checkout_session_id
       FROM audit_intakes WHERE id = ? LIMIT 1`
  ).bind(intakeId).first();

  if (!row) return json({ error: 'audit_intake_not_found' }, 404);
  if (row.status === 'paid' || row.status === 'fulfilled' || row.payment_state === 'paid') {
    return json({ error: 'audit_already_paid', audit_intake_id: row.id }, 409);
  }
  if (!['scoped', 'payment_ready'].includes(row.status)) return json({ error: 'audit_intake_not_scoped' }, 409);
  if (!row.scope_summary || !Number.isInteger(Number(row.scoped_price_usd))) return json({ error: 'scope_not_complete' }, 409);
  if (row.offer_type !== 'full_audit') return json({ error: 'invalid_offer_type' }, 409);

  const total = Number(row.scoped_price_usd);
  const credit = Number(row.prior_credit_usd || 0);
  const amountDue = total - credit;
  if (total !== FACT_AUDIT_PRICE_USD || credit !== 0 || amountDue !== FACT_AUDIT_PRICE_USD) {
    return json({ error: 'invalid_payment_amount', amount_due_usd: amountDue }, 409);
  }

  const siteUrl = clean(env?.PROOFTTL_WEB_URL, 1000) || 'https://proofttl-web.vercel.app';
  if (!isHttps(siteUrl)) return json({ error: 'invalid_web_url_configuration' }, 503);

  const previousSessionId = clean(row.stripe_checkout_session_id, 200);
  if (previousSessionId) {
    const existing = await retrieveStripeCheckout(secret, previousSessionId);
    if (!existing.ok) {
      if (existing.status !== 404) {
        console.error(JSON.stringify({ event: 'stripe_checkout_lookup_failed', intake_id: row.id, session_id: previousSessionId, status: existing.status }));
        return json({ error: 'stripe_checkout_lookup_failed' }, 502);
      }
      await clearCheckoutIfCurrent(env, row.id, previousSessionId);
    } else if (existing.session?.status === 'open' && existing.session?.url) {
      return json({
        ok: true,
        reused: true,
        audit_intake_id: row.id,
        payment: {
          provider: 'stripe', state: 'ready', amount_due_usd: amountDue,
          checkout_url: existing.session.url, checkout_session_id: previousSessionId
        }
      }, 200);
    } else if (existing.session?.status === 'complete' && existing.session?.payment_status === 'paid') {
      const completion = validatePaidSession(existing.session, row.id, amountDue);
      if (!completion.ok) return json({ error: completion.error }, 409);
      await markAuditPaid(env, row.id, existing.session, `checkout_recovery_${Date.now()}`);
      return json({ ok: true, recovered_paid_session: true, audit_intake_id: row.id, payment: { provider: 'stripe', state: 'paid', amount_due_usd: amountDue } }, 200);
    } else if (existing.session?.status === 'expired') {
      await clearCheckoutIfCurrent(env, row.id, previousSessionId);
    } else {
      return json({ error: 'stripe_checkout_not_reusable', stripe_status: existing.session?.status || 'unknown' }, 409);
    }
  }

  const offerName = 'ProofTTL Fact Audit';

  const returnBase = `${siteUrl.replace(/\/$/, '')}/audit/status/?request=${encodeURIComponent(row.id)}`;
  const params = new URLSearchParams();
  params.set('mode', 'payment');
  params.set('customer_email', row.email);
  params.set('client_reference_id', row.id);
  params.set('success_url', `${returnBase}&paid=1&session_id={CHECKOUT_SESSION_ID}`);
  params.set('cancel_url', `${returnBase}&cancelled=1`);
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

  const checkoutWindow = Math.floor(Date.now() / (60 * 60 * 1000));
  const generation = previousSessionId || 'initial';
  const stripeResponse = await fetch(`${STRIPE_API}/checkout/sessions`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${secret}`,
      'content-type': 'application/x-www-form-urlencoded',
      'idempotency-key': `proofttl-audit-${row.id}-${amountDue}-${checkoutWindow}-${generation}`.slice(0, 255)
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
       stripe_checkout_session_id = ?, payment_created_at_ms = ?
       WHERE id = ? AND status IN ('scoped','payment_ready') AND payment_state != 'paid'`
  ).bind(session.url, amountDue, session.id, now, row.id).run();

  return json({
    ok: true,
    audit_intake_id: row.id,
    payment: {
      provider: 'stripe', state: 'ready', amount_due_usd: amountDue,
      checkout_url: session.url, checkout_session_id: session.id
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
      await markWebhookProcessed(env, eventId);
      return json({ ok: true, ignored: 'checkout_session_not_paid' });
    }

    const expected = await env.MONITOR_DB.prepare(
      `SELECT id, status, amount_due_usd, stripe_checkout_session_id
         FROM audit_intakes WHERE id = ? LIMIT 1`
    ).bind(intakeId).first();
    if (!expected) return json({ error: 'audit_intake_not_found' }, 404);
    if (expected.status === 'paid' || expected.status === 'fulfilled') {
      await markWebhookProcessed(env, eventId);
      return json({ ok: true, duplicate_payment_state: true });
    }

    const completion = validatePaidSession(object, intakeId, Number(expected.amount_due_usd || 0));
    if (!completion.ok) return json({ error: completion.error }, 409);

    const siblingSessionId = clean(expected.stripe_checkout_session_id, 200);
    await markAuditPaid(env, intakeId, object, eventId);
    await markWebhookProcessed(env, eventId);

    if (siblingSessionId && siblingSessionId !== object.id) {
      void expireStripeCheckout(clean(env?.STRIPE_SECRET_KEY, 300), siblingSessionId).catch(() => {});
    }
    return json({ ok: true });
  }

  if (eventType === 'checkout.session.expired' && /^ati_[a-f0-9]{32}$/.test(intakeId)) {
    await clearCheckoutIfCurrent(env, intakeId, clean(object.id, 200));
  }

  await markWebhookProcessed(env, eventId);
  return json({ ok: true });
}

function validatePaidSession(session, intakeId, expectedAmountUsd) {
  const sessionIntakeId = clean(session?.metadata?.audit_intake_id || session?.client_reference_id, 80);
  if (sessionIntakeId !== intakeId) return { ok: false, error: 'stripe_audit_metadata_mismatch' };
  if (session?.payment_status !== 'paid') return { ok: false, error: 'stripe_session_not_paid' };
  const paidUsd = Number(session?.amount_total || 0) / 100;
  if (Number(expectedAmountUsd || 0) !== paidUsd) return { ok: false, error: 'stripe_amount_mismatch' };
  return { ok: true };
}

async function markAuditPaid(env, intakeId, session, eventId) {
  await env.MONITOR_DB.prepare(
    `UPDATE audit_intakes SET status = 'paid', payment_state = 'paid', paid_at_ms = ?,
       payment_provider = 'stripe', payment_url = NULL, stripe_checkout_session_id = ?,
       stripe_payment_intent_id = ?, stripe_last_event_id = ?
       WHERE id = ? AND status != 'fulfilled'`
  ).bind(Date.now(), clean(session?.id, 200) || null, clean(session?.payment_intent, 200) || null, eventId, intakeId).run();
}

async function clearCheckoutIfCurrent(env, intakeId, sessionId) {
  if (!sessionId) return;
  await env.MONITOR_DB.prepare(
    `UPDATE audit_intakes SET status = CASE WHEN status = 'payment_ready' THEN 'scoped' ELSE status END,
       payment_state = CASE WHEN payment_state = 'ready' THEN 'not_requested' ELSE payment_state END,
       payment_url = CASE WHEN payment_state = 'ready' THEN NULL ELSE payment_url END,
       stripe_checkout_session_id = CASE WHEN payment_state = 'ready' THEN NULL ELSE stripe_checkout_session_id END,
       payment_created_at_ms = CASE WHEN payment_state = 'ready' THEN NULL ELSE payment_created_at_ms END
       WHERE id = ? AND stripe_checkout_session_id = ? AND status NOT IN ('paid','fulfilled')`
  ).bind(intakeId, sessionId).run();
}

async function retrieveStripeCheckout(secret, sessionId) {
  try {
    const response = await fetch(`${STRIPE_API}/checkout/sessions/${encodeURIComponent(sessionId)}`, {
      method: 'GET', headers: { authorization: `Bearer ${secret}` }
    });
    const session = await response.json().catch(() => ({}));
    return { ok: response.ok, status: response.status, session };
  } catch {
    return { ok: false, status: 0, session: null };
  }
}

async function expireStripeCheckout(secret, sessionId) {
  if (!secret || !sessionId) return false;
  try {
    const response = await fetch(`${STRIPE_API}/checkout/sessions/${encodeURIComponent(sessionId)}/expire`, {
      method: 'POST', headers: { authorization: `Bearer ${secret}`, 'content-type': 'application/x-www-form-urlencoded' }, body: ''
    });
    return response.ok || response.status === 400;
  } catch { return false; }
}

async function markWebhookProcessed(env, eventId) {
  await env.MONITOR_DB.prepare('UPDATE stripe_webhook_events SET processed = 1 WHERE event_id = ?').bind(eventId).run();
}

export async function verifyStripeSignature(payload, header, secret, nowSeconds = Math.floor(Date.now() / 1000)) {
  const parts = header.split(',').map((part) => part.trim());
  const timestamp = parts.find((part) => part.startsWith('t='))?.slice(2);
  const signatures = parts.filter((part) => part.startsWith('v1=')).map((part) => part.slice(3));
  if (!timestamp || !signatures.length || !/^\d+$/.test(timestamp)) return { ok: false, error: 'invalid_stripe_signature' };

  const ts = Number(timestamp);
  if (Math.abs(nowSeconds - ts) > WEBHOOK_TOLERANCE_SECONDS) return { ok: false, error: 'stripe_signature_too_old' };

  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
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
