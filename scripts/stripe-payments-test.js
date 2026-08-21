import assert from 'node:assert/strict';
import { createAuditCheckoutSession, handleStripeWebhook } from '../src/stripe-payments.js';

const INTAKE = 'ati_11111111111111111111111111111111';
const WEBHOOK_SECRET = 'whsec_test_only';
const STRIPE_SECRET = 'sk_test_only';

function makeDb(overrides = {}) {
  const state = {
    row: {
      id: INTAKE,
      status: 'scoped',
      offer_type: 'stress_test',
      email: 'buyer@example.com',
      company_or_project: 'Example',
      scoped_price_usd: 129,
      scope_summary: 'Verify three launch claims.',
      scope_turnaround: '48 hours after payment',
      prior_credit_usd: 0,
      amount_due_usd: 129,
      payment_state: 'not_requested',
      payment_provider: null,
      payment_url: null,
      payment_created_at_ms: null,
      stripe_checkout_session_id: null,
      stripe_payment_intent_id: null,
      stripe_last_event_id: null,
      paid_at_ms: null,
      ...overrides,
    },
    events: new Map(),
  };

  return {
    state,
    prepare(sql) {
      return {
        args: [],
        bind(...args) { this.args = args; return this; },
        async first() {
          if (sql.includes('FROM stripe_webhook_events')) {
            const event = state.events.get(this.args[0]);
            return event ? { ...event } : null;
          }
          if (sql.includes('FROM audit_intakes')) {
            return this.args[0] === state.row.id ? { ...state.row } : null;
          }
          return null;
        },
        async run() {
          if (sql.includes('INSERT OR IGNORE INTO stripe_webhook_events')) {
            const [event_id, event_type, received_at_ms, audit_intake_id] = this.args;
            if (!state.events.has(event_id)) state.events.set(event_id, { event_id, event_type, received_at_ms, audit_intake_id, processed: 0 });
          } else if (sql.includes('UPDATE stripe_webhook_events SET processed = 1')) {
            const event = state.events.get(this.args[0]);
            if (event) event.processed = 1;
          } else if (sql.includes("SET status = 'payment_ready'")) {
            const [url, amount, sessionId, createdAt, id] = this.args;
            if (id === state.row.id && state.row.payment_state !== 'paid') {
              Object.assign(state.row, { status: 'payment_ready', payment_state: 'ready', payment_url: url, payment_provider: 'stripe', amount_due_usd: amount, stripe_checkout_session_id: sessionId, payment_created_at_ms: createdAt });
            }
          } else if (sql.includes("SET status = 'paid'")) {
            const [paidAt, sessionId, paymentIntent, eventId, id] = this.args;
            if (id === state.row.id && state.row.status !== 'fulfilled') {
              Object.assign(state.row, { status: 'paid', payment_state: 'paid', paid_at_ms: paidAt, payment_provider: 'stripe', payment_url: null, stripe_checkout_session_id: sessionId, stripe_payment_intent_id: paymentIntent, stripe_last_event_id: eventId });
            }
          } else if (sql.includes("stripe_checkout_session_id = CASE")) {
            const [id, sessionId] = this.args;
            if (id === state.row.id && state.row.stripe_checkout_session_id === sessionId && !['paid', 'fulfilled'].includes(state.row.status)) {
              if (state.row.status === 'payment_ready') state.row.status = 'scoped';
              if (state.row.payment_state === 'ready') {
                state.row.payment_state = 'not_requested';
                state.row.payment_url = null;
                state.row.stripe_checkout_session_id = null;
                state.row.payment_created_at_ms = null;
              }
            }
          }
          return { success: true };
        },
      };
    },
  };
}

function envFor(db) {
  return {
    MONITOR_DB: db,
    STRIPE_SECRET_KEY: STRIPE_SECRET,
    STRIPE_WEBHOOK_SECRET: WEBHOOK_SECRET,
    PROOFTTL_WEB_URL: 'https://proofttl-web.vercel.app',
  };
}

async function signedWebhook(event, nowSeconds = Math.floor(Date.now() / 1000)) {
  const payload = JSON.stringify(event);
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(WEBHOOK_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const digest = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${nowSeconds}.${payload}`));
  const signature = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  return new Request('https://proofttl.test/payments/stripe/webhook', {
    method: 'POST',
    headers: { 'stripe-signature': `t=${nowSeconds},v1=${signature}` },
    body: payload,
  });
}

const originalFetch = globalThis.fetch;
try {
  {
    const db = makeDb({ status: 'payment_ready', payment_state: 'ready', payment_url: 'https://checkout.stripe.test/open', stripe_checkout_session_id: 'cs_open' });
    let creates = 0;
    globalThis.fetch = async (url, options = {}) => {
      if (String(url).endsWith('/checkout/sessions/cs_open') && options.method === 'GET') {
        return Response.json({ id: 'cs_open', status: 'open', payment_status: 'unpaid', url: 'https://checkout.stripe.test/open' });
      }
      if (String(url).endsWith('/checkout/sessions') && options.method === 'POST') creates += 1;
      return new Response('{}', { status: 500 });
    };
    const response = await createAuditCheckoutSession(new Request('https://proofttl.test/admin'), envFor(db), INTAKE);
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.reused, true);
    assert.equal(body.payment.checkout_session_id, 'cs_open');
    assert.equal(creates, 0, 'an existing open checkout must be reused, not duplicated');
  }

  {
    const db = makeDb({ status: 'payment_ready', payment_state: 'ready', payment_url: 'https://checkout.stripe.test/new', stripe_checkout_session_id: 'cs_new' });
    globalThis.fetch = async () => new Response('{}', { status: 200 });
    const event = { id: 'evt_expired_old', type: 'checkout.session.expired', data: { object: { id: 'cs_old', client_reference_id: INTAKE, metadata: { audit_intake_id: INTAKE } } } };
    const response = await handleStripeWebhook(await signedWebhook(event), envFor(db));
    assert.equal(response.status, 200);
    assert.equal(db.state.row.stripe_checkout_session_id, 'cs_new', 'an old expiration cannot clear a newer checkout');
    assert.equal(db.state.row.payment_state, 'ready');
  }

  {
    const db = makeDb({ status: 'payment_ready', payment_state: 'ready', payment_url: 'https://checkout.stripe.test/new', stripe_checkout_session_id: 'cs_new' });
    const expired = [];
    globalThis.fetch = async (url, options = {}) => {
      if (String(url).endsWith('/checkout/sessions/cs_new/expire') && options.method === 'POST') {
        expired.push('cs_new');
        return Response.json({ id: 'cs_new', status: 'expired' });
      }
      return new Response('{}', { status: 500 });
    };
    const event = {
      id: 'evt_paid_old', type: 'checkout.session.completed',
      data: { object: { id: 'cs_old', client_reference_id: INTAKE, payment_status: 'paid', amount_total: 12900, payment_intent: 'pi_paid', metadata: { audit_intake_id: INTAKE, amount_due_usd: '129' } } },
    };
    const response = await handleStripeWebhook(await signedWebhook(event), envFor(db));
    assert.equal(response.status, 200);
    assert.equal(db.state.row.status, 'paid');
    assert.equal(db.state.row.stripe_checkout_session_id, 'cs_old', 'the valid session that actually paid becomes the canonical payment session');
    assert.equal(db.state.row.stripe_payment_intent_id, 'pi_paid');
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.deepEqual(expired, ['cs_new'], 'a sibling open checkout is retired after another valid session pays');
  }

  {
    const db = makeDb({ status: 'payment_ready', payment_state: 'ready', stripe_checkout_session_id: 'cs_current' });
    globalThis.fetch = async () => new Response('{}', { status: 200 });
    const event = {
      id: 'evt_wrong_amount', type: 'checkout.session.completed',
      data: { object: { id: 'cs_wrong', client_reference_id: INTAKE, payment_status: 'paid', amount_total: 12800, payment_intent: 'pi_wrong', metadata: { audit_intake_id: INTAKE } } },
    };
    const response = await handleStripeWebhook(await signedWebhook(event), envFor(db));
    assert.equal(response.status, 409);
    assert.equal((await response.json()).error, 'stripe_amount_mismatch');
    assert.notEqual(db.state.row.status, 'paid', 'wrong amount can never mark an audit paid');
  }

  {
    const db = makeDb({ status: 'payment_ready', payment_state: 'ready', stripe_checkout_session_id: 'cs_expired', payment_url: 'https://checkout.stripe.test/expired' });
    let creates = 0;
    let createKey = '';
    globalThis.fetch = async (url, options = {}) => {
      if (String(url).endsWith('/checkout/sessions/cs_expired') && options.method === 'GET') {
        return Response.json({ id: 'cs_expired', status: 'expired', payment_status: 'unpaid', url: null });
      }
      if (String(url).endsWith('/checkout/sessions') && options.method === 'POST') {
        creates += 1;
        createKey = options.headers['idempotency-key'];
        return Response.json({ id: 'cs_replacement', status: 'open', payment_status: 'unpaid', url: 'https://checkout.stripe.test/replacement' });
      }
      return new Response('{}', { status: 500 });
    };
    const response = await createAuditCheckoutSession(new Request('https://proofttl.test/admin'), envFor(db), INTAKE);
    assert.equal(response.status, 201);
    assert.equal(creates, 1);
    assert.match(createKey, /cs_expired$/, 'replacement checkout generation must differ from the original generation');
    assert.equal(db.state.row.stripe_checkout_session_id, 'cs_replacement');
  }

  console.log('SUCCESS: stale-session-safe Stripe audit lifecycle checks passed.');
} finally {
  globalThis.fetch = originalFetch;
}
