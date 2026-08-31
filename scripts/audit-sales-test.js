import { handleAuditStatus, handleAuditAdmin } from '../src/audit-sales.js';

let passed = 0;
function assert(condition, message) { if (!condition) throw new Error(message); passed += 1; console.log(`PASS ${passed}: ${message}`); }

function dbFor(row = {}) {
  const state = { row: { id: 'ati_11111111111111111111111111111111', status: 'received', offer_type: 'full_audit', approximate_claims: '16-25', email: 'buyer@example.com', company_or_project: 'Example', website_url: 'https://example.com', claim_scope: 'Customer-facing launch claims', why_it_matters: 'Launch risk', payment_state: 'not_requested', payment_provider: null, payment_url: null, prior_credit_usd: 0, amount_due_usd: null, ...row } };
  return { state, prepare(sql) { return { args: [], bind(...args) { this.args = args; return this; }, async first() { if (sql.includes('WHERE id = ?')) return this.args[0] === state.row.id ? { ...state.row } : null; return null; }, async all() { return { results: [{ ...state.row }] }; }, async run() {
    if (sql.includes("SET status = 'scoped', scope_summary")) { const [summary, price, amountDue, turnaround, scopedAt] = this.args; Object.assign(state.row, { status: 'scoped', scope_summary: summary, scoped_price_usd: price, prior_credit_usd: 0, amount_due_usd: amountDue, scope_turnaround: turnaround, scoped_at_ms: scopedAt, payment_url: null, payment_provider: null, payment_state: 'not_requested' }); }
    else if (sql.includes("SET status = 'paid'")) Object.assign(state.row, { status: 'paid', payment_state: 'paid', paid_at_ms: this.args[0] });
    else if (sql.includes("SET status = 'fulfilled'")) Object.assign(state.row, { status: 'fulfilled', fulfilled_at_ms: this.args[0] });
    else if (sql.includes("SET status = 'cancelled'")) state.row.status = 'cancelled';
    return { success: true };
  } }; } };
}

function adminRequest(path, body, token = 'secret') { return new Request(`https://proofttl.test${path}`, { method: body === undefined ? 'GET' : 'POST', headers: { ...(body === undefined ? {} : { 'content-type': 'application/json' }), authorization: `Bearer ${token}` }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }); }

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

  const statusRequest = new Request('https://proofttl.test/audit/intake/status', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ audit_intake_id: id, email: 'buyer@example.com' }) });
  const statusBody = await (await handleAuditStatus(statusRequest, env)).json();
  assert(statusBody.offer_type === 'fact_audit' && statusBody.scope?.amount_due_usd === 1500, 'buyer status exposes canonical Fact Audit amount');

  const badPrice = await handleAuditAdmin(adminRequest(`/admin/audit/intakes/${id}/scope`, { scope_summary: 'Bad price', price_usd: 500, scope_turnaround: '48 hours' }), env, `/admin/audit/intakes/${id}/scope`);
  assert(badPrice.status === 400, 'retired $500 price cannot be scoped');
  const retiredUpgrade = await handleAuditAdmin(adminRequest(`/admin/audit/intakes/${id}/upgrade`, {}), env, `/admin/audit/intakes/${id}/upgrade`);
  assert(retiredUpgrade.status === 410, 'legacy upgrade route is explicitly retired');

  assert((await handleAuditAdmin(adminRequest(`/admin/audit/intakes/${id}/mark-paid`, {}), env, `/admin/audit/intakes/${id}/mark-paid`)).status === 200, 'scoped audit can be marked paid');
  assert((await handleAuditAdmin(adminRequest(`/admin/audit/intakes/${id}/fulfill`, {}), env, `/admin/audit/intakes/${id}/fulfill`)).status === 200, 'paid audit can move to fulfilled');
  console.log(`\nSUCCESS: ${passed} audit-sales checks passed.`);
}
run().catch((error) => { console.error('\nAUDIT SALES TEST FAILED:', error.stack || error.message); process.exitCode = 1; });
