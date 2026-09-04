import { handleAuditStatus, handleAuditAdmin } from '../src/audit-sales.js';

let passed = 0;
function assert(condition, message) { if (!condition) throw new Error(message); passed += 1; console.log(`PASS ${passed}: ${message}`); }

function dbFor(row = {}) {
  const state = { row: { id: 'ati_11111111111111111111111111111111', status: 'received', offer_type: 'full_audit', approximate_claims: '16-25', email: 'buyer@example.com', company_or_project: 'Example', website_url: 'https://example.com', claim_scope: 'Customer-facing launch claims', why_it_matters: 'Launch risk', payment_state: 'not_requested', payment_provider: null, payment_url: null, prior_credit_usd: 0, amount_due_usd: null, human_approved_at_ms: null, human_approved_by: null, report_url: null, report_sha256: null, report_delivered_at_ms: null, watch_started_at_ms: null, watch_ends_at_ms: null, fulfilled_at_ms: null, ...row } };
  return { state, prepare(sql) { return { args: [], bind(...args) { this.args = args; return this; }, async first() { if (sql.includes('WHERE id = ?')) return this.args[0] === state.row.id ? { ...state.row } : null; return null; }, async all() { return { results: [{ ...state.row }] }; }, async run() {
    if (sql.includes("SET status = 'scoped', scope_summary")) {
      const [summary, price, amountDue, turnaround, scopedAt] = this.args;
      Object.assign(state.row, { status: 'scoped', scope_summary: summary, scoped_price_usd: price, prior_credit_usd: 0, amount_due_usd: amountDue, scope_turnaround: turnaround, scoped_at_ms: scopedAt, payment_url: null, payment_provider: null, payment_state: 'not_requested', human_approved_at_ms: null, human_approved_by: null, report_url: null, report_sha256: null, report_delivered_at_ms: null, watch_started_at_ms: null, watch_ends_at_ms: null, fulfilled_at_ms: null });
    }
    else if (sql.includes("SET status = 'paid'")) Object.assign(state.row, { status: 'paid', payment_state: 'paid', paid_at_ms: this.args[0] });
    else if (sql.includes('SET human_approved_at_ms')) Object.assign(state.row, { human_approved_at_ms: this.args[0], human_approved_by: this.args[1] });
    else if (sql.includes("SET status = 'fulfilled'")) {
      const [reportUrl, reportSha256, deliveredAt, watchStartedAt, watchEndsAt, fulfilledAt] = this.args;
      Object.assign(state.row, { status: 'fulfilled', report_url: reportUrl, report_sha256: reportSha256, report_delivered_at_ms: deliveredAt, watch_started_at_ms: watchStartedAt, watch_ends_at_ms: watchEndsAt, fulfilled_at_ms: fulfilledAt });
    }
    else if (sql.includes("SET status = 'cancelled'")) state.row.status = 'cancelled';
    return { success: true };
  } }; } };
}

function adminRequest(path, body, token = 'secret') { return new Request(`https://proofttl.test${path}`, { method: body === undefined ? 'GET' : 'POST', headers: { ...(body === undefined ? {} : { 'content-type': 'application/json' }), authorization: `Bearer ${token}` }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }); }
function statusRequest(id) { return new Request('https://proofttl.test/audit/intake/status', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ audit_intake_id: id, email: 'buyer@example.com' }) }); }

async function run() {
  console.log('ProofTTL audit sales lifecycle tests\n');
  const env = { MONITOR_DB: dbFor(), PROOFTTL_ADMIN_TOKEN: 'secret' };
  const id = env.MONITOR_DB.state.row.id;
  assert((await handleAuditAdmin(adminRequest('/admin/audit/intakes', undefined, 'wrong'), env, '/admin/audit/intakes')).status === 401, 'admin queue fails closed on wrong token');
  assert((await handleAuditAdmin(adminRequest('/admin/audit/intakes?status=received', undefined), env, '/admin/audit/intakes')).status === 200, 'authorized admin can read sales queue');

  const scoped = await handleAuditAdmin(adminRequest(`/admin/audit/intakes/${id}/scope`, { scope_summary: 'Verify up to 25 claims with authoritative evidence and human approval.', price_usd: 1500, scope_turnaround: '3-5 business days after payment' }), env, `/admin/audit/intakes/${id}/scope`);
  const scopedBody = await scoped.json();
  assert(scopedBody.status === 'scoped' && scopedBody.amount_due_usd === 1500, 'scoping fixes the canonical amount due at $1,500');
  assert(env.MONITOR_DB.state.row.scoped_price_usd === 1500 && env.MONITOR_DB.state.row.prior_credit_usd === 0, 'Fact Audit price is stored without legacy credits');

  const statusBody = await (await handleAuditStatus(statusRequest(id), env)).json();
  assert(statusBody.offer_type === 'fact_audit' && statusBody.scope?.amount_due_usd === 1500, 'buyer status exposes canonical Fact Audit amount');
  assert(statusBody.human_review?.approved === false && statusBody.delivery?.delivered === false && statusBody.watch?.state === 'not_started', 'buyer status exposes approval, delivery, and watch state before fulfillment');

  const badPrice = await handleAuditAdmin(adminRequest(`/admin/audit/intakes/${id}/scope`, { scope_summary: 'Bad price', price_usd: 500, scope_turnaround: '48 hours' }), env, `/admin/audit/intakes/${id}/scope`);
  assert(badPrice.status === 400, 'retired $500 price cannot be scoped');
  const retiredUpgrade = await handleAuditAdmin(adminRequest(`/admin/audit/intakes/${id}/upgrade`, {}), env, `/admin/audit/intakes/${id}/upgrade`);
  assert(retiredUpgrade.status === 410, 'legacy upgrade route is explicitly retired');

  const paid = await handleAuditAdmin(adminRequest(`/admin/audit/intakes/${id}/mark-paid`, {}), env, `/admin/audit/intakes/${id}/mark-paid`);
  const paidBody = await paid.json();
  assert(paid.status === 200 && paidBody.next_step === 'human_approval_required', 'paid Fact Audit explicitly requires human approval next');

  const prematureFulfill = await handleAuditAdmin(adminRequest(`/admin/audit/intakes/${id}/fulfill`, { report_url: 'https://example.com/report', report_sha256: 'a'.repeat(64) }), env, `/admin/audit/intakes/${id}/fulfill`);
  assert(prematureFulfill.status === 409, 'paid audit cannot be fulfilled before human approval');

  const missingReviewer = await handleAuditAdmin(adminRequest(`/admin/audit/intakes/${id}/approve`, {}), env, `/admin/audit/intakes/${id}/approve`);
  assert(missingReviewer.status === 400, 'human approval requires a named reviewer');

  const approved = await handleAuditAdmin(adminRequest(`/admin/audit/intakes/${id}/approve`, { reviewer: 'ProofTTL reviewer' }), env, `/admin/audit/intakes/${id}/approve`);
  assert(approved.status === 200 && Boolean(env.MONITOR_DB.state.row.human_approved_at_ms), 'paid audit records human approval before delivery');

  const badReportUrl = await handleAuditAdmin(adminRequest(`/admin/audit/intakes/${id}/fulfill`, { report_url: 'http://example.com/report', report_sha256: 'a'.repeat(64) }), env, `/admin/audit/intakes/${id}/fulfill`);
  assert(badReportUrl.status === 400, 'fulfillment requires an HTTPS report URL');
  const badReportHash = await handleAuditAdmin(adminRequest(`/admin/audit/intakes/${id}/fulfill`, { report_url: 'https://example.com/report', report_sha256: 'not-a-hash' }), env, `/admin/audit/intakes/${id}/fulfill`);
  assert(badReportHash.status === 400, 'fulfillment requires a SHA-256 report digest');

  const fulfilled = await handleAuditAdmin(adminRequest(`/admin/audit/intakes/${id}/fulfill`, { report_url: 'https://example.com/report', report_sha256: 'b'.repeat(64) }), env, `/admin/audit/intakes/${id}/fulfill`);
  const fulfilledBody = await fulfilled.json();
  assert(fulfilled.status === 200 && fulfilledBody.status === 'fulfilled', 'approved paid audit can be fulfilled with a report');
  assert(fulfilledBody.watch?.duration_days === 7 && fulfilledBody.watch.ends_at_ms - fulfilledBody.watch.started_at_ms === 7 * 24 * 60 * 60 * 1000, 'fulfillment starts an exact seven-day watch');

  const finalStatus = await (await handleAuditStatus(statusRequest(id), env)).json();
  assert(finalStatus.human_review?.approved === true, 'buyer status retains human approval after fulfillment');
  assert(finalStatus.delivery?.delivered === true && finalStatus.delivery.report_sha256 === 'b'.repeat(64), 'buyer status exposes delivered report identity after fulfillment');
  assert(finalStatus.watch?.state === 'active' && finalStatus.watch?.duration_days === 7, 'buyer status exposes the active seven-day watch after delivery');

  console.log(`\nSUCCESS: ${passed} audit-sales checks passed.`);
}
run().catch((error) => { console.error('\nAUDIT SALES TEST FAILED:', error.stack || error.message); process.exitCode = 1; });
