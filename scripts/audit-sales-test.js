import { handleAuditStatus, handleAuditAdmin } from '../src/audit-sales.js';

let passed = 0;
function assert(condition, message) {
  if (!condition) throw new Error(message);
  passed += 1;
  console.log(`PASS ${passed}: ${message}`);
}

function dbFor(row = {}) {
  const state = {
    row: {
      id: 'ati_11111111111111111111111111111111',
      status: 'received',
      offer_type: 'stress_test',
      approximate_claims: '3-5',
      email: 'buyer@example.com',
      company_or_project: 'Example',
      website_url: 'https://example.com',
      claim_scope: 'Three launch claims',
      why_it_matters: 'Launch risk',
      payment_state: 'not_requested',
      ...row
    }
  };
  return {
    state,
    prepare(sql) {
      return {
        args: [],
        bind(...args) { this.args = args; return this; },
        async first() {
          if (sql.includes('lower(email)')) {
            const [id, email] = this.args;
            return id === state.row.id && email === state.row.email.toLowerCase() ? { ...state.row } : null;
          }
          if (sql.includes('WHERE id = ?')) return this.args[0] === state.row.id ? { ...state.row } : null;
          return null;
        },
        async all() { return { results: [{ ...state.row }] }; },
        async run() {
          if (sql.includes("SET status = ?, scope_summary")) {
            const [status, summary, price, turnaround, scopedAt, paymentUrl, paymentState] = this.args;
            Object.assign(state.row, { status, scope_summary: summary, scoped_price_usd: price, scope_turnaround: turnaround, scoped_at_ms: scopedAt, payment_url: paymentUrl, payment_state: paymentState });
          } else if (sql.includes("SET status = 'paid'")) {
            Object.assign(state.row, { status: 'paid', payment_state: 'paid', paid_at_ms: this.args[0] });
          } else if (sql.includes("SET status = 'fulfilled'")) {
            Object.assign(state.row, { status: 'fulfilled', fulfilled_at_ms: this.args[0] });
          } else if (sql.includes("SET status = 'cancelled'")) {
            state.row.status = 'cancelled';
          }
          return { success: true };
        }
      };
    }
  };
}

function adminRequest(path, body, token = 'secret') {
  return new Request(`https://proofttl.test${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { ...(body === undefined ? {} : { 'content-type': 'application/json' }), authorization: `Bearer ${token}` },
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  });
}

async function run() {
  console.log('ProofTTL audit sales lifecycle tests\n');
  const env = { MONITOR_DB: dbFor(), PROOFTTL_ADMIN_TOKEN: 'secret' };
  const id = env.MONITOR_DB.state.row.id;

  const unauthorized = await handleAuditAdmin(adminRequest('/admin/audit/intakes', undefined, 'wrong'), env, '/admin/audit/intakes');
  assert(unauthorized.status === 401, 'admin sales queue fails closed on wrong token');

  const list = await handleAuditAdmin(adminRequest('/admin/audit/intakes?status=received', undefined), env, '/admin/audit/intakes');
  assert(list.status === 200, 'authorized admin can read sales queue');

  const scoped = await handleAuditAdmin(adminRequest(`/admin/audit/intakes/${id}/scope`, {
    scope_summary: 'Verify three launch claims against first-party documentation.',
    price_usd: 129,
    scope_turnaround: '48 hours after payment',
    payment_url: 'https://payments.example/checkout/abc'
  }), env, `/admin/audit/intakes/${id}/scope`);
  const scopedBody = await scoped.json();
  assert(scopedBody.status === 'payment_ready', 'scoping with an HTTPS payment URL makes intake payment-ready');
  assert(env.MONITOR_DB.state.row.scoped_price_usd === 129, 'stress-test price is stored as $129');

  const statusRequest = new Request('https://proofttl.test/audit/intake/status', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ audit_intake_id: id, email: 'buyer@example.com' })
  });
  const status = await handleAuditStatus(statusRequest, env);
  const statusBody = await status.json();
  assert(statusBody.payment?.url === 'https://payments.example/checkout/abc', 'buyer can retrieve payment URL only with intake ID plus matching email');

  const badPrice = await handleAuditAdmin(adminRequest(`/admin/audit/intakes/${id}/scope`, {
    scope_summary: 'Bad price', price_usd: 500, scope_turnaround: '48 hours'
  }), env, `/admin/audit/intakes/${id}/scope`);
  assert(badPrice.status === 400, 'stress test cannot silently be repriced away from $129');

  const paid = await handleAuditAdmin(adminRequest(`/admin/audit/intakes/${id}/mark-paid`, {}), env, `/admin/audit/intakes/${id}/mark-paid`);
  assert(paid.status === 200 && env.MONITOR_DB.state.row.status === 'paid', 'payment can be marked after scope is ready');

  const fulfilled = await handleAuditAdmin(adminRequest(`/admin/audit/intakes/${id}/fulfill`, {}), env, `/admin/audit/intakes/${id}/fulfill`);
  assert(fulfilled.status === 200 && env.MONITOR_DB.state.row.status === 'fulfilled', 'paid audit can move to fulfilled');

  console.log(`\nSUCCESS: ${passed} audit-sales checks passed.`);
}

run().catch((error) => {
  console.error('\nAUDIT SALES TEST FAILED:', error.stack || error.message);
  process.exitCode = 1;
});
