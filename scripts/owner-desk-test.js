import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { auditTestDb } from './audit-test-db.js';
import { handleOwnerDesk, handlePrivateAuditReport } from '../src/owner-desk.js';
import { handleStripeWebhook } from '../src/stripe-payments.js';

const id='ati_'+'b'.repeat(32);
const db=auditTestDb({id,email:'buyer@example.test',company_or_project:'Fixture audit',status:'received',offer_type:'full_audit',payment_state:'not_requested'});
const secret='local-owner-fixture-012345678901234567890123456789';
const env={MONITOR_DB:db,BETTER_AUTH_SECRET:secret,PROOFTTL_WEB_URL:'https://proofttl.test',PROOFTTL_ADMIN_TOKEN:'local-admin',STRIPE_SECRET_KEY:'sk_test_fixture',STRIPE_WEBHOOK_SECRET:'whsec_fixture'};
const now=Date.now();
for(const [user,email,v] of [['owner','tasx13ok@gmail.com',1],['unverified','g0f0rth3kil1@gmail.com',0],['buyer','buyer@example.test',1],['other','other@example.test',1]]){
  db.sqlite.prepare('INSERT INTO user(id,name,email,emailVerified,createdAt,updatedAt) VALUES(?,?,?,?,?,?)').run(user,user,email,v,now,now);
  db.sqlite.prepare('INSERT INTO session(id,token,userId,expiresAt,createdAt,updatedAt) VALUES(?,?,?,?,?,?)').run(user,user+'-token',user,now+86400000,now,now);
}
function req(path,body,user='owner',origin=env.PROOFTTL_WEB_URL){
  const token=user+'-token';
  const cookie='__Secure-proofttl.session_token='+encodeURIComponent(token+'.'+createHmac('sha256',secret).update(token).digest('base64'));
  return new Request(env.PROOFTTL_WEB_URL+path,{method:body===undefined?'GET':'POST',headers:{...(user?{cookie}:{}),origin,'content-type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});
}
async function call(path,body,user,origin){const r=await handleOwnerDesk(req(path,body,user,origin),env);return {status:r.status,body:await r.json(),headers:r.headers};}
const action=(name,body={})=>call(`/owner/intakes/${id}/${name}`,body);
try{
  assert.equal((await call('/owner/overview',undefined,'')).status,401);
  assert.equal((await call('/owner/overview',undefined,'other')).status,403);
  assert.equal((await call('/owner/overview',undefined,'unverified')).status,403);
  assert.equal((await call('/owner/tasks',{title:'attack'},'owner','https://attacker.test')).status,403);
  assert.equal((await call('/owner/tasks',null)).status,400);
  assert.equal((await call('/owner/tasks',{title:'x'.repeat(17000)})).status,413);
  let overview=await call('/owner/overview');
  assert.equal(overview.status,200);assert.equal(overview.body.counts.received,1);
  assert.equal(overview.headers.get('cache-control'),'private, no-store');
  assert.equal(overview.body.recorded_payments_usd,0);
  assert.equal((await call('/owner/intakes?q=Fixture')).body.intakes.length,1);
  assert.equal((await call('/owner/intakes?q=%27%20OR%201%3D1--')).body.intakes.length,0);
  assert.equal((await call('/owner/intakes?offset=50')).body.intakes.length,0);
  const task=await call('/owner/tasks',{title:'Review the request'});
  assert.equal(task.status,201);
  assert.equal((await call('/owner/tasks/'+task.body.id,{remove:true})).status,409);
  assert.equal((await call('/owner/tasks/'+task.body.id,{done:true})).status,200);
  assert.equal((await call('/owner/tasks/'+task.body.id,{remove:true})).status,200);
  assert.equal((await action('notes',{body:'Owner-only note'})).status,201);
  const detail=await call('/owner/intakes/'+id);
  assert.equal(detail.body.notes[0].body,'Owner-only note');
  assert.equal('request_fingerprint' in detail.body.intake,false);
  assert.equal((await action('deliver',{report_sha256:'a'.repeat(64)})).status,409);
  assert.equal((await action('report',{body:'Draft',expected_sha256:null})).status,409);
  assert.equal((await action('scope',{})).status,400);
  assert.equal((await action('scope',{scope_summary:'10 fixture claims',scope_turnaround:'Five business days',price_usd:1})).status,200);
  assert.equal(db.state.row.amount_due_usd,1500,'owner browser cannot change the offer price');
  const originalFetch=globalThis.fetch;
  try{
    globalThis.fetch=async(_url,options)=>{
      const params=new URLSearchParams(options.body);
      assert.equal(params.get('line_items[0][price_data][unit_amount]'),'150000');
      assert.equal(params.get('metadata[audit_intake_id]'),id);
      return Response.json({id:'cs_owner_fixture',url:'https://checkout.stripe.com/c/pay/cs_owner_fixture'});
    };
    assert.equal((await action('checkout')).status,201);
  }finally{globalThis.fetch=originalFetch;}
  assert.equal((await action('cancel')).status,409);
  assert.equal((await action('scope',{scope_summary:'Changed',scope_turnaround:'Later'})).status,409);
  const event={id:'evt_owner_fixture',type:'checkout.session.completed',data:{object:{id:'cs_owner_fixture',metadata:{audit_intake_id:id},currency:'usd',amount_total:150000,payment_status:'paid',payment_intent:'pi_owner_fixture'}}};
  const raw=JSON.stringify(event),timestamp=Math.floor(Date.now()/1000);
  const signature=createHmac('sha256',env.STRIPE_WEBHOOK_SECRET).update(`${timestamp}.${raw}`).digest('hex');
  assert.equal((await handleStripeWebhook(new Request('https://proofttl.test/payments/stripe/webhook',{method:'POST',headers:{'stripe-signature':`t=${timestamp},v1=${signature}`},body:raw}),env)).status,200);
  const saved=await action('report',{body:'# Local test report\nA fixture, not a real audit. <script>test</script>',expected_sha256:null});
  assert.equal(saved.status,200);const hash=saved.body.sha256;
  assert.equal((await action('approve',{report_sha256:hash})).status,400);
  assert.equal((await action('approve',{report_sha256:'a'.repeat(64),reviewed:true})).status,409);
  assert.equal((await action('approve',{report_sha256:hash,reviewed:true})).status,200);
  assert.equal(db.state.row.human_approved_by,'tasx13ok@gmail.com');
  assert.equal((await action('report',{body:'Stale tab overwrite',expected_sha256:null})).status,409);
  const revised=await action('report',{body:'# Revised fixture\nStill only a test.',expected_sha256:hash});
  assert.equal(revised.status,200);assert.equal(db.state.row.human_approved_at_ms,null);
  assert.equal((await action('deliver',{report_sha256:revised.body.sha256})).status,409);
  assert.equal((await handlePrivateAuditReport(req('/audit/report/'+id,undefined,'buyer'),env,id)).status,404);
  assert.equal((await action('approve',{report_sha256:revised.body.sha256,reviewed:true})).status,200);
  assert.equal((await action('deliver',{report_sha256:hash})).status,409);
  assert.equal((await action('deliver',{report_sha256:revised.body.sha256})).status,200);
  assert.equal((await action('deliver',{report_sha256:revised.body.sha256})).status,200,'publish safely repeats');
  assert.equal(db.state.row.watch_ends_at_ms-db.state.row.watch_started_at_ms,604800000);
  assert.equal((await action('report',{body:'Published overwrite',expected_sha256:revised.body.sha256})).status,409);
  assert.throws(()=>db.sqlite.prepare('UPDATE owner_audit_reports SET body=? WHERE intake_id=?').run('wrong',id),/immutable/);
  assert.equal((await handlePrivateAuditReport(req('/audit/report/'+id,undefined,''),env,id)).status,401);
  assert.equal((await handlePrivateAuditReport(req('/audit/report/'+id,undefined,'other'),env,id)).status,404);
  const customer=await handlePrivateAuditReport(req('/audit/report/'+id,undefined,'buyer'),env,id);
  assert.equal(customer.status,200);assert.equal((await customer.json()).report.body,'# Revised fixture\nStill only a test.');
  overview=await call('/owner/overview');assert.equal(overview.body.recorded_payments_usd,1500);assert.equal(overview.body.active_watches,1);
  assert.equal(overview.body.counts.fulfilled,1);
  console.log('PASS: owner session isolation, verified identity, CSRF, bounded input, real SQLite migration, tasks, private notes, fixed-price Stripe checkout fixture, signed payment event, revision-safe human approval, immutable delivery, customer report isolation and seven-day watch. No live charge or customer record was created.');
} finally {db.sqlite.close();}
