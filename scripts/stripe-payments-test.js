import { auditTestDb } from './audit-test-db.js';
import assert from 'node:assert/strict';
import { createAuditCheckoutSession, handleStripeWebhook } from '../src/stripe-payments.js';

const INTAKE = 'ati_11111111111111111111111111111111';
const WEBHOOK_SECRET = 'whsec_test_only';
const STRIPE_SECRET = 'sk_test_only';
const FACT_AUDIT_PRICE_USD = 1500;

function makeDb(overrides = {}) { return auditTestDb({
      id: INTAKE,
      status: 'scoped',
      offer_type: 'full_audit',
      email: 'buyer@example.com',
      company_or_project: 'Example',
      scoped_price_usd: FACT_AUDIT_PRICE_USD,
      scope_summary: 'Verify the highest-risk launch claims.',
      scope_turnaround: '3–5 business days after payment',
      prior_credit_usd: 0,
      amount_due_usd: FACT_AUDIT_PRICE_USD,
      payment_state: 'not_requested',
      payment_provider: null,
      payment_url: null,
      payment_created_at_ms: null,
      stripe_checkout_session_id: null,
      stripe_payment_intent_id: null,
      stripe_last_event_id: null,
      paid_at_ms: null,
      ...overrides }); }

function envFor(db) {
  return { MONITOR_DB: db, STRIPE_SECRET_KEY: STRIPE_SECRET, STRIPE_WEBHOOK_SECRET: WEBHOOK_SECRET, PROOFTTL_WEB_URL: 'https://proofttl-web.vercel.app' };
}

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
    const db = makeDb({ status: 'payment_ready', payment_state: 'ready', payment_url: 'https://checkout.stripe.test/open', stripe_checkout_session_id: 'cs_open' });
    let creates = 0;
    globalThis.fetch = async (url, options = {}) => {
      if (String(url).endsWith('/checkout/sessions/cs_open') && options.method === 'GET') return Response.json({ id: 'cs_open', client_reference_id: INTAKE, currency: 'usd', amount_total: 150000, status: 'open', payment_status: 'unpaid', url: 'https://checkout.stripe.test/open' });
      if (String(url).endsWith('/checkout/sessions') && options.method === 'POST') creates += 1;
      return new Response('{}', { status: 500 });
    };
    const response = await createAuditCheckoutSession(new Request('https://proofttl.test/admin'), envFor(db), INTAKE);
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.reused, true);
    assert.equal(body.payment.amount_due_usd, FACT_AUDIT_PRICE_USD);
    assert.equal(creates, 0, 'an existing open checkout must be reused, not duplicated');
  }

  {
    const db = makeDb();
    let postedBody = '';
    globalThis.fetch = async (url, options = {}) => {
      if (String(url).endsWith('/checkout/sessions') && options.method === 'POST') {
        postedBody = String(options.body || '');
        return Response.json({ id: 'cs_fact_audit', status: 'open', payment_status: 'unpaid', url: 'https://checkout.stripe.test/fact-audit' });
      }
      return new Response('{}', { status: 500 });
    };
    const response = await createAuditCheckoutSession(new Request('https://proofttl.test/admin'), envFor(db), INTAKE);
    assert.equal(response.status, 201);
    const params = new URLSearchParams(postedBody);
    assert.equal(params.get('line_items[0][price_data][unit_amount]'), '150000');
    assert.equal(params.get('line_items[0][price_data][product_data][name]'), 'ProofTTL Fact Audit');
    assert.equal(params.get('metadata[amount_due_usd]'), '1500');
  }

  {
    const db = makeDb({ scoped_price_usd: 500, amount_due_usd: 500 });
    globalThis.fetch = async () => { throw new Error('Stripe must not be called for retired pricing'); };
    const response = await createAuditCheckoutSession(new Request('https://proofttl.test/admin'), envFor(db), INTAKE);
    assert.equal(response.status, 409);
    assert.equal((await response.json()).error, 'invalid_payment_amount');
  }

  {
    const db = makeDb({ status: 'payment_ready', payment_state: 'ready', payment_url: 'https://checkout.stripe.test/new', stripe_checkout_session_id: 'cs_new' });
    globalThis.fetch = async () => new Response('{}', { status: 200 });
    const event = { id: 'evt_expired_old', type: 'checkout.session.expired', data: { object: { id: 'cs_old', client_reference_id: INTAKE, metadata: { audit_intake_id: INTAKE } } } };
    const response = await handleStripeWebhook(await signedWebhook(event), envFor(db));
    assert.equal(response.status, 200);
    assert.equal(db.state.row.stripe_checkout_session_id, 'cs_new');
    assert.equal(db.state.row.payment_state, 'ready');
  }

  {
    const db = makeDb({ status: 'payment_ready', payment_state: 'ready', payment_url: 'https://checkout.stripe.test/new', stripe_checkout_session_id: 'cs_new' });
    const expired = [];
    globalThis.fetch = async (url, options = {}) => {
      if (String(url).endsWith('/checkout/sessions/cs_new/expire') && options.method === 'POST') { expired.push('cs_new'); return Response.json({ id: 'cs_new', status: 'expired' }); }
      return new Response('{}', { status: 500 });
    };
    const event = { id: 'evt_paid_old', type: 'checkout.session.completed', data: { object: { id: 'cs_old', client_reference_id: INTAKE, payment_status: 'paid', currency: 'usd', amount_total: 150000, payment_intent: 'pi_paid', metadata: { audit_intake_id: INTAKE, amount_due_usd: '1500' } } } };
    const response = await handleStripeWebhook(await signedWebhook(event), envFor(db));
    assert.equal(response.status, 200);
    assert.equal(db.state.row.status, 'paid');
    assert.equal(db.state.row.stripe_checkout_session_id, 'cs_old');
    assert.equal(db.state.row.stripe_payment_intent_id, 'pi_paid');
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.deepEqual(expired, ['cs_new']);
  }

  {
    const db = makeDb({ status: 'payment_ready', payment_state: 'ready', stripe_checkout_session_id: 'cs_current' });
    globalThis.fetch = async () => new Response('{}', { status: 200 });
    const event = { id: 'evt_wrong_amount', type: 'checkout.session.completed', data: { object: { id: 'cs_wrong', client_reference_id: INTAKE, payment_status: 'paid', currency: 'usd', amount_total: 149900, payment_intent: 'pi_wrong', metadata: { audit_intake_id: INTAKE } } } };
    const response = await handleStripeWebhook(await signedWebhook(event), envFor(db));
    assert.equal(response.status, 409);
    assert.equal((await response.json()).error, 'stripe_amount_mismatch');
    assert.notEqual(db.state.row.status, 'paid');
  }

  {
    const db = makeDb({ status: 'payment_ready', payment_state: 'ready', stripe_checkout_session_id: 'cs_expired', payment_url: 'https://checkout.stripe.test/expired' });
    let creates = 0;
    globalThis.fetch = async (url, options = {}) => {
      if (String(url).endsWith('/checkout/sessions/cs_expired') && options.method === 'GET') return Response.json({ id: 'cs_expired', status: 'expired', payment_status: 'unpaid', url: null });
      if (String(url).endsWith('/checkout/sessions') && options.method === 'POST') { creates += 1; return Response.json({ id: 'cs_replacement', status: 'open', payment_status: 'unpaid', url: 'https://checkout.stripe.test/replacement' }); }
      return new Response('{}', { status: 500 });
    };
    const response = await createAuditCheckoutSession(new Request('https://proofttl.test/admin'), envFor(db), INTAKE);
    assert.equal(response.status, 201);
    assert.equal(creates, 1);
    assert.equal(db.state.row.stripe_checkout_session_id, 'cs_replacement');
  }

  {
    const db = makeDb({ status: 'payment_ready', payment_state: 'ready' });
    const event = { id: 'evt_async_paid', type: 'checkout.session.async_payment_succeeded', data: { object: { id: 'cs_async', client_reference_id: INTAKE, payment_status: 'paid', currency: 'usd', amount_total: 150000, metadata: { audit_intake_id: INTAKE } } } };
    const response = await handleStripeWebhook(await signedWebhook(event), envFor(db));
    assert.equal(response.status, 200);
    assert.equal(db.state.row.status, 'paid', 'delayed payment success must not strand a paid customer');
    const duplicate = await handleStripeWebhook(await signedWebhook(event), envFor(db));
    assert.equal(duplicate.status, 200);
    assert.equal((await duplicate.json()).duplicate, true);
  }

  for (const currency of ['eur', undefined]) {
    const db = makeDb({ status: 'payment_ready', payment_state: 'ready' });
    const event = { id: 'evt_currency_' + currency, type: 'checkout.session.completed', data: { object: { id: 'cs_currency', client_reference_id: INTAKE, payment_status: 'paid', currency, amount_total: 150000, metadata: { audit_intake_id: INTAKE } } } };
    const response = await handleStripeWebhook(await signedWebhook(event), envFor(db));
    assert.equal(response.status, 409);
    assert.equal((await response.json()).error, 'stripe_currency_mismatch');
    assert.notEqual(db.state.row.status, 'paid');
  }
  {
    const db = makeDb();
    const sessions = new Map();
    const keys = [];
    globalThis.fetch = async (_url, options) => {
      const key = options.headers['idempotency-key'];
      keys.push(key);
      if (!sessions.has(key)) sessions.set(key, { id: 'cs_race', url: 'https://checkout.stripe.test/race' });
      return Response.json(sessions.get(key));
    };
    const responses = await Promise.all([0, 1].map(() => createAuditCheckoutSession(new Request('https://proofttl.test/admin'), envFor(db), INTAKE)));
    assert(responses.every(r => r.status === 201));
    assert.equal(new Set(keys).size, 1, 'simultaneous checkout calls reserve the same durable Stripe key');
    assert.equal(sessions.size, 1);
  }
  {
    const db = makeDb();
    const prepare = db.prepare.bind(db);
    let failStore = true;
    db.prepare = (sql) => {
      const statement = prepare(sql);
      if (sql.includes('payment_url = ?')) {
        const first = statement.first.bind(statement);
        statement.first = async () => { if (failStore) { failStore = false; throw new Error('simulated D1 outage'); } return first(); };
      }
      return statement;
    };
    const keys = [];
    globalThis.fetch = async (_url, options) => { keys.push(options.headers['idempotency-key']); return Response.json({ id: 'cs_lost_write', url: 'https://checkout.stripe.test/retry' }); };
    await assert.rejects(createAuditCheckoutSession(new Request('https://proofttl.test/admin'), envFor(db), INTAKE), /D1 outage/);
    const realNow = Date.now;
    try {
      Date.now = () => realNow() + 2 * 60 * 60 * 1000;
      const retry = await createAuditCheckoutSession(new Request('https://proofttl.test/admin'), envFor(db), INTAKE);
      assert.equal(retry.status, 201);
      assert.equal(keys[0], keys[1], 'retry after an hour boundary must recover the same Stripe session');
    } finally { Date.now = realNow; }
  }
  {
    const db = makeDb({ checkout_attempt_id: 'uncertain-old-attempt', payment_created_at_ms: Date.now() - 24 * 60 * 60 * 1000 });
    globalThis.fetch = async () => { throw new Error('must reconcile an old uncertain attempt'); };
    const response = await createAuditCheckoutSession(new Request('https://proofttl.test/admin'), envFor(db), INTAKE);
    assert.equal((await response.json()).error, 'checkout_reconciliation_required');
  }
  {
    const db = makeDb({ stripe_checkout_session_id: 'cs_missing' });
    let calls = 0;
    globalThis.fetch = async () => { calls++; return new Response('{}', { status: 404 }); };
    const response = await createAuditCheckoutSession(new Request('https://proofttl.test/admin'), envFor(db), INTAKE);
    assert.equal(response.status, 502, 'a missing session may mean the wrong Stripe account; do not create another');
    assert.equal(calls, 1);
  }
  console.log('SUCCESS: exact $1,500 Fact Audit Stripe lifecycle, concurrency and recovery checks passed.');
} finally {
  globalThis.fetch = originalFetch;
}
