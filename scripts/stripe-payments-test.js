import assert from 'node:assert/strict';
import { createAuditCheckoutSession, handleStripeWebhook } from '../src/stripe-payments.js';

const INTAKE = 'ati_11111111111111111111111111111111';
const WEBHOOK_SECRET = 'whsec_test_only';
const STRIPE_SECRET = 'sk_test_only';

function makeDb(overrides = {}) {
  const state = { row: { id: INTAKE, status: 'scoped', offer_type: 'full_audit', email: 'buyer@example.com', company_or_project: 'Example', scoped_price_usd: 1500, scope_summary: 'Verify up to 25 customer-facing claims.', scope_turnaround: '3-5 business days', prior_credit_usd: 0, amount_due_usd: 1500, payment_state: 'not_requested', payment_provider: null, payment_url: null, payment_created_at_ms: null, stripe_checkout_session_id: null, stripe_payment_intent_id: null, stripe_last_event_id: null, paid_at_ms: null, ...overrides }, events: new Map() };
  return { state, prepare(sql) { return { args: [], bind(...args) { this.args = args; return this; }, async first() {
    if (sql.includes('FROM stripe_webhook_events')) { const event = state.events.get(this.args[0]); return event ? { ...event } : null; }
    if (sql.includes('FROM audit_intakes')) return this.args[0] === state.row.id ? { ...state.row } : null;
    return null;
  }, async run() {
    if (sql.includes('INSERT OR IGNORE INTO stripe_webhook_events')) { const [event_id, event_type, received_at_ms, audit_intake_id] = this.args; if (!state.events.has(event_id)) state.events.set(event_id, { event_id, event_type, received_at_ms, audit_intake_id, processed: 0 }); }
    else if (sql.includes('UPDATE stripe_webhook_events SET processed = 1')) { const event = state.events.get(this.args[0]); if (event) event.processed = 1; }
    else if (sql.includes("SET status = 'payment_ready'")) { const [url, amount, sessionId, createdAt, id] = this.args; if (id === state.row.id && state.row.payment_state !== 'paid') Object.assign(state.row, { status: 'payment_ready', payment_state: 'ready', payment_url: url, payment_provider: 'stripe', amount_due_usd: amount, stripe_checkout_session_id: sessionId, payment_created_at_ms: createdAt }); }
    else if (sql.includes("SET status = 'paid'")) { const [paidAt, sessionId, paymentIntent, eventId, id] = this.args; if (id === state.row.id && state.row.status !== 'fulfilled') Object.assign(state.row, { status: 'paid', payment_state: 'paid', paid_at_ms: paidAt, payment_provider: 'stripe', payment_url: null, stripe_checkout_session_id: sessionId, stripe_payment_intent_id: paymentIntent, stripe_last_event_id: eventId }); }
    else if (sql.includes('stripe_checkout_session_id = CASE')) { const [id, sessionId] = this.args; if (id === state.row.id && state.row.stripe_checkout_session_id === sessionId && !['paid', 'fulfilled'].includes(state.row.status)) { if (state.row.status === 'payment_ready') state.row.status = 'scoped'; if (state.row.payment_state === 'ready') { state.row.payment_state = 'not_requested'; state.row.payment_url = null; state.row.stripe_checkout_session_id = null; state.row.payment_created_at_ms = null; } } }
    return { success: true };
  } }; } };
}

function envFor(db) { return { MONITOR_DB: db, STRIPE_SECRET_KEY: STRIPE_SECRET, STRIPE_WEBHOOK_SECRET: WEBHOOK_SECRET, PROOFTTL_WEB_URL: 'https://proofttl-web.vercel.app' }; }

async function signedWebhook(event, nowSeconds = Math.floor(Date.now() / 1000)) {
  const payload = JSON.stringify(event);
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(WEBHOOK_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const digest = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${nowSeconds}.${payload}`));
  const signature = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  return new Request('https://proofttl.test/payments/stripe/webhook', { method: 'POST', headers: { 'stripe-signature': `t=${nowSeconds},v1=${signature}` }, body: payload });
}

const originalFetch = globalThis.fetch;
try {
  {
    const db = makeDb();
    let postedBody = '';
    globalThis.fetch = async (url, options = {}) => {
      if (String(url).endsWith('/checkout/sessions') && options.method === 'POST') { postedBody = String(options.body); return Response.json({ id: 'cs_new', status: 'open', payment_status: 'unpaid', url: 'https://checkout.stripe.test/new' }); }
      return new Response('{}', { status: 500 });
    };
    const response = await createAuditCheckoutSession(new Request('https://proofttl.test/admin'), envFor(db), INTAKE);
    assert.equal(response.status, 201);
    assert.match(postedBody, /unit_amount=150000/, 'Stripe checkout charges exactly $1,500');
    assert.match(postedBody, /ProofTTL\+Fact\+Audit/, 'Stripe line item uses the flagship Fact Audit name');
    assert.equal(db.state.row.amount_due_usd, 1500);
  }

  {
    const db = makeDb({ status: 'payment_ready', payment_state: 'ready', payment_url: 'https://checkout.stripe.test/open', stripe_checkout_session_id: 'cs_open' });
    let creates = 0;
    globalThis.fetch = async (url, options = {}) => {
      if (String(url).endsWith('/checkout/sessions/cs_open') && options.method === 'GET') return Response.json({ id: 'cs_open', status: 'open', payment_status: 'unpaid', amount_total: 150000, client_reference_id: INTAKE, metadata: { audit_intake_id: INTAKE, amount_due_usd: '1500' }, url: 'https://checkout.stripe.test/open' });
      if (String(url).endsWith('/checkout/sessions') && options.method === 'POST') creates += 1;
      return new Response('{}', { status: 500 });
    };
    const response = await createAuditCheckoutSession(new Request('https://proofttl.test/admin'), envFor(db), INTAKE);
    assert.equal(response.status, 200);
    assert.equal((await response.json()).reused, true);
    assert.equal(creates, 0, 'a valid open checkout is reused');
  }

  {
    const db = makeDb({ scoped_price_usd: 500, amount_due_usd: 500 });
    globalThis.fetch = async () => { throw new Error('should not call Stripe'); };
    const response = await createAuditCheckoutSession(new Request('https://proofttl.test/admin'), envFor(db), INTAKE);
    assert.equal(response.status, 409);
    assert.equal((await response.json()).error, 'invalid_payment_amount');
  }

  {
    const db = makeDb({ status: 'payment_ready', payment_state: 'ready', stripe_checkout_session_id: 'cs_current' });
    globalThis.fetch = async () => new Response('{}', { status: 200 });
    const event = { id: 'evt_paid', type: 'checkout.session.completed', data: { object: { id: 'cs_paid', client_reference_id: INTAKE, payment_status: 'paid', amount_total: 150000, payment_intent: 'pi_paid', metadata: { audit_intake_id: INTAKE, amount_due_usd: '1500' } } } };
    const response = await handleStripeWebhook(await signedWebhook(event), envFor(db));
    assert.equal(response.status, 200);
    assert.equal(db.state.row.status, 'paid');
  }

  {
    const db = makeDb({ status: 'payment_ready', payment_state: 'ready', stripe_checkout_session_id: 'cs_current' });
    globalThis.fetch = async () => new Response('{}', { status: 200 });
    const event = { id: 'evt_wrong_amount', type: 'checkout.session.completed', data: { object: { id: 'cs_wrong', client_reference_id: INTAKE, payment_status: 'paid', amount_total: 50000, payment_intent: 'pi_wrong', metadata: { audit_intake_id: INTAKE } } } };
    const response = await handleStripeWebhook(await signedWebhook(event), envFor(db));
    assert.equal(response.status, 409);
    assert.equal((await response.json()).error, 'stripe_amount_mismatch');
    assert.notEqual(db.state.row.status, 'paid');
  }

  console.log('SUCCESS: canonical $1,500 Stripe Fact Audit lifecycle checks passed.');
} finally {
  globalThis.fetch = originalFetch;
}
