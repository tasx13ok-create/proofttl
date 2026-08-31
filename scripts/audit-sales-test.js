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
      offer_type: 'full_audit',
      approximate_claims: '16-25',
      email: 'buyer@example.com',
      company_or_project: 'Example',
      website_url: 'https://example.com',
      claim_scope: 'High-consequence launch claims',
      why_it_matters: 'Launch risk',
      payment_state: 'not_requested',
      payment_provider: null,
      payment_url: null,
      prior_credit_usd: 0,
      amount_due_usd: null,
      human_approved_at_ms: null,
      human_approved_by: null,
      report_url: null,
      report_sha256: null,
      report_delivered_at_ms: null,
      watch_started_at_ms: null,
      watch_ends_at_ms: null,
      fulfilled_at_ms: null,
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
          if (sql.includes("SET status = 'scoped', scope_summary")) {
            const [summary, price, amountDue, turnaround, scopedAt] = this.args;
            Object.assign(state.row, {
              status: 'scoped', scope_summary: summary, scoped_price_usd: price, prior_credit_usd: 0,
              amount_due_usd: amountDue, scope_turnaround: turnaround, scoped_at_ms: scopedAt,
              payment_url: null, payment_provider: null, payment_state: 'not_requested',
              human_approved_at_ms: null, human_approved_by: null, report_url: null, report_sha256: null,
              report_delivered_at_ms: null, watch_started_at_ms: null, watch_ends_at_ms: null, fulfilled_at_ms: null
            });
          } else if (sql.includes("SET status = 'paid'")) {
            Object.assign(state.row, { status: 'paid', payment_state: 'paid', paid_at_ms: this.args[0] });
          } else if (sql.includes('human_approved_at_ms = ?')) {
            const [approvedAt, reviewer] = this.args;
            Object.assign(state.row, { human_approved_at_ms: approvedAt, human_approved_by: reviewer });
          } else if (sql.includes("SET status = 'fulfilled'")) {
            const [reportUrl, reportSha256, deliveredAt, watchStarted, watchEnds, fulfilledAt] = this.args;
            Object.assign(state.row, {
              status: 'fulfilled', report_url: reportUrl, report_sha256: reportSha256,
              report_delivered_at_ms: deliveredAt, watch_started_at_ms: watchStarted,
              watch_ends_at_ms: watchEnds, fulfilled_at_ms: fulfilledAt
            });
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
    scope_summary: 'Verify the highest-risk launch claims against authoritative evidence.',
    price_usd: 1500,
    scope_turnaround: '3–5 business days after payment'
  }), env, `/admin/audit/intakes/${id}/scope`);
  const scopedBody = await scoped.json();
  assert(scopedBody.status === 'scoped', 'scoping prepares the Fact Audit without creating or trusting an arbitrary payment URL');
  assert(scopedBody.amount_due_usd === 1500, 'scoping returns the exact $1,500 amount due');
  assert(env.MONITOR_DB.state.row.scoped_price_usd === 1500, 'Fact Audit price is stored as $1,500');
  assert(env.MONITOR_DB.state.row.prior_credit_usd === 0, 'Fact Audit has no retired upgrade credit');
  assert(env.MONITOR_DB.state.row.payment_url === null, 'scope flow does not persist caller-supplied payment URLs');
  assert(env.MONITOR_DB.state.row.payment_state === 'not_requested', 'payment stays not-requested until Stripe creates checkout');

  const statusRequest = () => new Request('https://proofttl.test/audit/intake/status', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ audit_intake_id: id, email: 'buyer@example.com' })
  });
  const status = await handleAuditStatus(statusRequest(), env);
  const statusBody = await status.json();
  assert(statusBody.scope?.amount_due_usd === 1500, 'buyer can retrieve the exact $1,500 scoped amount');
  assert(statusBody.payment?.url === null, 'buyer status does not expose a payment URL before Stripe checkout exists');
  assert(statusBody.payment?.state === 'not_requested', 'buyer status reports payment not requested before checkout creation');
  assert(statusBody.human_review?.approved === false, 'buyer status exposes pending human approval');
  assert(statusBody.watch?.state === 'not_started', 'seven-day watch cannot start before delivery');

  const badPrice = await handleAuditAdmin(adminRequest(`/admin/audit/intakes/${id}/scope`, {
    scope_summary: 'Bad price', price_usd: 500, scope_turnaround: '3–5 business days'
  }), env, `/admin/audit/intakes/${id}/scope`);
  assert(badPrice.status === 400, 'Fact Audit cannot silently regress to retired $500 pricing');

  const retiredUpgrade = await handleAuditAdmin(adminRequest(`/admin/audit/intakes/${id}/upgrade`, {}), env, `/admin/audit/intakes/${id}/upgrade`);
  assert(retiredUpgrade.status === 404, 'retired upgrade route is quarantined');

  const paid = await handleAuditAdmin(adminRequest(`/admin/audit/intakes/${id}/mark-paid`, {}), env, `/admin/audit/intakes/${id}/mark-paid`);
  const paidBody = await paid.json();
  assert(paid.status === 200 && env.MONITOR_DB.state.row.status === 'paid', 'payment can be marked after scope is ready');
  assert(paidBody.next_step === 'human_approval_required', 'paid audit explicitly requires human approval next');

  const prematureFulfill = await handleAuditAdmin(adminRequest(`/admin/audit/intakes/${id}/fulfill`, {
    report_url: 'https://reports.proofttl.test/report.pdf', report_sha256: 'a'.repeat(64)
  }), env, `/admin/audit/intakes/${id}/fulfill`);
  assert(prematureFulfill.status === 409, 'paid audit cannot be fulfilled before human approval');
  assert((await prematureFulfill.json()).error === 'human_approval_required_before_fulfillment', 'premature fulfillment fails with explicit human-approval blocker');

  const missingReviewer = await handleAuditAdmin(adminRequest(`/admin/audit/intakes/${id}/approve`, {}), env, `/admin/audit/intakes/${id}/approve`);
  assert(missingReviewer.status === 400, 'human approval requires a named reviewer');

  const approved = await handleAuditAdmin(adminRequest(`/admin/audit/intakes/${id}/approve`, { reviewer: 'ProofTTL Human Review' }), env, `/admin/audit/intakes/${id}/approve`);
  assert(approved.status === 200 && Boolean(env.MONITOR_DB.state.row.human_approved_at_ms), 'paid audit records explicit human approval');

  const badReport = await handleAuditAdmin(adminRequest(`/admin/audit/intakes/${id}/fulfill`, {
    report_url: 'http://reports.proofttl.test/report.pdf', report_sha256: 'a'.repeat(64)
  }), env, `/admin/audit/intakes/${id}/fulfill`);
  assert(badReport.status === 400, 'fulfillment requires an HTTPS proof/report delivery URL');

  const fulfilled = await handleAuditAdmin(adminRequest(`/admin/audit/intakes/${id}/fulfill`, {
    report_url: 'https://reports.proofttl.test/report.pdf', report_sha256: 'b'.repeat(64)
  }), env, `/admin/audit/intakes/${id}/fulfill`);
  const fulfilledBody = await fulfilled.json();
  assert(fulfilled.status === 200 && env.MONITOR_DB.state.row.status === 'fulfilled', 'human-approved paid audit can move to fulfilled');
  assert(fulfilledBody.delivery?.report_sha256 === 'b'.repeat(64), 'fulfillment records immutable report digest');
  assert(fulfilledBody.watch?.duration_days === 7 && fulfilledBody.watch?.state === 'active', 'fulfillment starts the contractual seven-day watch');
  assert(fulfilledBody.watch.ends_at_ms - fulfilledBody.watch.started_at_ms === 7 * 24 * 60 * 60 * 1000, 'seven-day watch duration is exact');

  const fulfilledStatus = await handleAuditStatus(statusRequest(), env);
  const fulfilledStatusBody = await fulfilledStatus.json();
  assert(fulfilledStatusBody.human_review?.approved === true, 'buyer status confirms human approval');
  assert(fulfilledStatusBody.delivery?.report_url === 'https://reports.proofttl.test/report.pdf', 'buyer status exposes delivered proof/report after delivery');
  assert(fulfilledStatusBody.watch?.state === 'active', 'buyer status exposes active seven-day watch');

  console.log(`\nSUCCESS: ${passed} audit-sales checks passed.`);
}

run().catch((error) => {
  console.error('\nAUDIT SALES TEST FAILED:', error.stack || error.message);
  process.exitCode = 1;
});
