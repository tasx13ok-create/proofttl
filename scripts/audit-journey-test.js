import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { auditTestDb } from './audit-test-db.js';
import { handleAuditIntake } from '../src/audit-intake.js';
import { handleAuditStatus, handleAuditAdmin } from '../src/audit-sales.js';
import { getOptionalProofTTLSession } from '../src/auth.js';
import { createAuditCheckoutSession, handleStripeWebhook } from '../src/stripe-payments.js';

const db = auditTestDb();
// D1's batch method is how Better Auth identifies its SQLite adapter.
db.batch = async statements => Promise.all(statements.map(s => s.all()));
const secret = 'local-fixture-only-012345678901234567890123456789';
const env = { MONITOR_DB: db, BETTER_AUTH_SECRET: secret, PROOFTTL_WEB_URL: 'https://proofttl.test', PROOFTTL_ADMIN_TOKEN: 'local-admin', STRIPE_SECRET_KEY: 'sk_test_fixture', STRIPE_WEBHOOK_SECRET: 'whsec_fixture' };
const now = Date.now();
for (const [id, email] of [['buyer', 'buyer@example.com'], ['other', 'other@example.com']]) {
  db.sqlite.prepare('INSERT INTO user(id,name,email,emailVerified,createdAt,updatedAt) VALUES(?,?,?,1,?,?)').run(id,id,email,now,now);
  db.sqlite.prepare('INSERT INTO session(id,token,userId,expiresAt,createdAt,updatedAt) VALUES(?,?,?,?,?,?)').run(id,id+'-token',id,now+86400000,now,now);
}
function request(path, body, user = 'buyer') {
  const token = user+'-token';
  const signed = encodeURIComponent(token+'.'+createHmac('sha256',secret).update(token).digest('base64'));
  return new Request('https://proofttl.test'+path, {method:'POST',headers:{'content-type':'application/json',cookie:'__Secure-proofttl.session_token='+signed,authorization:'Bearer local-admin'},body:JSON.stringify(body)});
}
const payload = { email:'buyer@example.com',company_or_project:'Local release fixture',claim_scope:'Ten synthetic claims for release verification',approximate_claims:'10-15',why_it_matters:'No customer data or money',offer_type:'full_audit' };
assert.equal((await getOptionalProofTTLSession(request('/audit/intake',{}),env))?.user?.id,'buyer','real Better Auth validates the signed fixture session');
const created = await Promise.all([0,1].map(()=>handleAuditIntake(request('/audit/intake',payload),env)));
const bodies = await Promise.all(created.map(r=>r.json()));
assert(bodies.every(b=>b.ok),JSON.stringify(bodies));
const id=bodies[0].audit_intake_id;
assert.equal(bodies[1].audit_intake_id,id,'concurrent intake returns the same request');
assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS n FROM audit_intakes').get().n,1);
assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS n FROM account_audit_links').get().n,1);
assert.equal((await handleAuditStatus(request('/audit/intake/status',{audit_intake_id:id,email:payload.email},'other'),env)).status,404,'another signed-in account cannot claim buyer status');
const admin=async(action,body)=>handleAuditAdmin(request(`/admin/audit/intakes/${id}/${action}`,body),env,`/admin/audit/intakes/${id}/${action}`);
assert.equal((await admin('scope',{scope_summary:'10 scoped fixture claims',price_usd:1500,scope_turnaround:'3–5 business days'})).status,200);
const originalFetch=globalThis.fetch;
try {
  globalThis.fetch=async(_url,options)=>{
    const params=new URLSearchParams(options.body);
    assert.equal(params.get('line_items[0][price_data][unit_amount]'),'150000');
    return Response.json({id:'cs_fixture',url:'https://checkout.stripe.test/fixture'});
  };
  assert.equal((await createAuditCheckoutSession(request('/admin',{}),env,id)).status,201);
  assert.equal((await admin('mark-paid',{})).status,409);
  const event={id:'evt_fixture',type:'checkout.session.completed',data:{object:{id:'cs_fixture',metadata:{audit_intake_id:id},currency:'usd',amount_total:150000,payment_status:'paid',payment_intent:'pi_fixture'}}};
  const raw=JSON.stringify(event), timestamp=Math.floor(Date.now()/1000);
  const signature=createHmac('sha256',env.STRIPE_WEBHOOK_SECRET).update(`${timestamp}.${raw}`).digest('hex');
  const webhook=()=>new Request('https://proofttl.test/payments/stripe/webhook',{method:'POST',headers:{'stripe-signature':`t=${timestamp},v1=${signature}`},body:raw});
  assert.equal((await handleStripeWebhook(webhook(),env)).status,200);
  assert.equal((await handleStripeWebhook(webhook(),env)).status,200);
  assert.equal((await admin('approve',{reviewer:'Fixture reviewer'})).status,200);
  assert.equal((await admin('fulfill',{report_url:'https://reports.example.com/fixture.pdf',report_sha256:'a'.repeat(64)})).status,200);
  const status=await (await handleAuditStatus(request('/audit/intake/status',{audit_intake_id:id}),env)).json();
  assert.equal(status.status,'fulfilled');
  assert.equal(status.payment.state,'paid');
  assert.equal(status.delivery.report_url,'https://reports.example.com/fixture.pdf');
  assert.equal(status.watch.ends_at_ms-status.watch.started_at_ms,604800000);
  assert.equal(status.watch.state,'active');
  console.log('SUCCESS: authenticated local buyer journey, concurrent intake, account isolation, signed webhook, approval, delivery and seven-day watch. Stripe and report hosting are fixtures; OAuth was not simulated as live.');
} finally {globalThis.fetch=originalFetch;db.sqlite.close();}
