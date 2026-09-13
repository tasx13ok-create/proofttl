import { getOptionalProofTTLSession } from './auth.js';
import { isProofTTLOwnerSession } from './owner-access.js';
import { handleAuditAdmin } from './audit-sales.js';
import { createAuditCheckoutSession } from './stripe-payments.js';
import { readTextLimited } from './bounded-body.js';

const STATES = ['received', 'scoped', 'payment_ready', 'paid', 'fulfilled', 'cancelled'];
const ID = /^ati_[a-f0-9]{32}$/;
const json = (body, status = 200) => Response.json(body, { status, headers: { 'cache-control': 'private, no-store', 'x-robots-tag': 'noindex, nofollow', 'x-content-type-options': 'nosniff' } });
const clean = (value, max) => typeof value === 'string' ? value.trim().slice(0, max) : '';
const verified = session => session?.user?.id && session.user.emailVerified === true;

export async function handleOwnerDesk(request, env) {
  const session = await getOptionalProofTTLSession(request, env);
  if (!session?.user?.id) return json({ error: 'authentication_required' }, 401);
  if (!verified(session) || !isProofTTLOwnerSession(session)) return json({ error: 'owner_access_required' }, 403);
  if (!env.MONITOR_DB) return json({ error: 'owner_storage_unavailable' }, 503);
  const url = new URL(request.url), path = url.pathname;
  const actor = session.user.email;
  let body = {};
  if (request.method !== 'GET') {
    if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
    // Cookie authentication requires a first-party origin for every mutation.
    const origin = String(env.PROOFTTL_WEB_URL || '').replace(/\/$/, '');
    if (!origin || request.headers.get('origin') !== origin) return json({ error: 'trusted_origin_required' }, 403);
    if (request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') return json({ error: 'json_required' }, 415);
    try { body = JSON.parse(await readTextLimited(request, path.endsWith('/report') ? 600000 : 16000)); }
    catch (error) { return json({ error: error instanceof RangeError ? 'request_too_large' : 'invalid_json' }, error instanceof RangeError ? 413 : 400); }
    if (!body || typeof body !== 'object' || Array.isArray(body)) return json({error:'invalid_json'},400);
  }
  try {
    if (path === '/owner/overview' && request.method === 'GET') {
      const counts = await env.MONITOR_DB.prepare('SELECT status, COUNT(*) AS count FROM audit_intakes GROUP BY status').all();
      const totals = await env.MONITOR_DB.prepare(`SELECT COALESCE(SUM(CASE WHEN payment_state = 'paid' THEN amount_due_usd ELSE 0 END),0) AS recorded_payments_usd, SUM(CASE WHEN status = 'fulfilled' AND watch_ends_at_ms > ? THEN 1 ELSE 0 END) AS active_watches FROM audit_intakes`).bind(Date.now()).first();
      const recent = await env.MONITOR_DB.prepare('SELECT id, company_or_project, status, created_at_ms FROM audit_intakes ORDER BY created_at_ms DESC LIMIT 6').all();
      const tasks = await env.MONITOR_DB.prepare('SELECT * FROM owner_desk_tasks ORDER BY done ASC, created_at_ms DESC LIMIT 100').all();
      const events = await env.MONITOR_DB.prepare('SELECT e.*, a.company_or_project FROM owner_audit_events e JOIN audit_intakes a ON a.id=e.intake_id ORDER BY e.created_at_ms DESC LIMIT 12').all();
      return json({ ok: true, owner: { name: session.user.name || 'Owner', email: actor }, counts: Object.fromEntries(STATES.map(s => [s, Number(counts.results?.find(r => r.status === s)?.count || 0)])), recorded_payments_usd: Number(totals?.recorded_payments_usd || 0), active_watches: Number(totals?.active_watches || 0), recent: recent.results || [], tasks: tasks.results || [], activity: events.results || [], services: { auth: true, database: true, checkout: Boolean(env.STRIPE_SECRET_KEY && env.PROOFTTL_ADMIN_TOKEN), stripe_mode: /^(sk|rk)_live_/.test(env.STRIPE_SECRET_KEY || '') ? 'live' : env.STRIPE_SECRET_KEY ? 'test' : 'unconfigured', webhook: Boolean(env.STRIPE_WEBHOOK_SECRET), admin_controls: Boolean(env.PROOFTTL_ADMIN_TOKEN) } });
    }
    if (path === '/owner/intakes' && request.method === 'GET') {
      const status = url.searchParams.get('status') || 'all';
      if (status !== 'all' && !STATES.includes(status)) return json({ error: 'invalid_status' }, 400);
      const search = clean(url.searchParams.get('q'), 120);
      const offset = Math.floor(Math.max(0, Math.min(Number(url.searchParams.get('offset')) || 0, 100000)));
      const where = "(? = 'all' OR status = ?) AND (? = '' OR company_or_project LIKE ? OR email LIKE ? OR id LIKE ?)";
      const args = [status,status,search,...Array(3).fill('%'+search+'%')];
      const rows = await env.MONITOR_DB.prepare(`SELECT id,company_or_project,email,status,approximate_claims,created_at_ms,amount_due_usd,payment_state,watch_ends_at_ms FROM audit_intakes WHERE ${where} ORDER BY created_at_ms DESC LIMIT 51 OFFSET ?`).bind(...args,offset).all();
      return json({ ok:true, intakes:(rows.results || []).slice(0,50), has_more:(rows.results || []).length > 50, offset });
    }
    if (path === '/owner/tasks' && request.method === 'POST') {
      const title = clean(body.title, 240);
      if (!title) return json({ error:'task_title_required' },400);
      const count = await env.MONITOR_DB.prepare('SELECT COUNT(*) AS count FROM owner_desk_tasks').first();
      if (count.count >= 100) return json({ error:'task_limit_reached' },409);
      const id = crypto.randomUUID(), now = Date.now();
      await env.MONITOR_DB.prepare('INSERT INTO owner_desk_tasks(id,title,created_by,created_at_ms,updated_at_ms) VALUES(?,?,?,?,?)').bind(id,title,actor,now,now).run();
      return json({ok:true,id},201);
    }
    const task = path.match(/^\/owner\/tasks\/([a-f0-9-]{36})$/);
    if (task && request.method === 'POST') {
      if (body.remove === true) {
        const removed = await env.MONITOR_DB.prepare('DELETE FROM owner_desk_tasks WHERE id=? AND done=1 RETURNING id').bind(task[1]).first();
        return removed ? json({ok:true}) : json({error:'complete_task_before_removing'},409);
      }
      if (typeof body.done !== 'boolean') return json({error:'task_state_required'},400);
      const row = await env.MONITOR_DB.prepare('UPDATE owner_desk_tasks SET done=?,updated_at_ms=? WHERE id=? RETURNING id').bind(body.done?1:0,Date.now(),task[1]).first();
      return row ? json({ok:true}) : json({error:'task_not_found'},404);
    }
    const match = path.match(/^\/owner\/intakes\/(ati_[a-f0-9]{32})(?:\/(scope|checkout|approve|deliver|cancel|notes|report))?$/);
    if (!match) return json({error:'not_found'},404);
    const [,id,action] = match;
    const row = await env.MONITOR_DB.prepare('SELECT * FROM audit_intakes WHERE id=? LIMIT 1').bind(id).first();
    if (!row) return json({error:'audit_intake_not_found'},404);
    if (request.method === 'GET' && !action) {
      const notes = await env.MONITOR_DB.prepare('SELECT id,body,created_by,created_at_ms FROM owner_audit_notes WHERE intake_id=? ORDER BY created_at_ms DESC LIMIT 100').bind(id).all();
      const events = await env.MONITOR_DB.prepare('SELECT action,actor,created_at_ms FROM owner_audit_events WHERE intake_id=? ORDER BY created_at_ms DESC LIMIT 100').bind(id).all();
      const report = await env.MONITOR_DB.prepare('SELECT body,sha256,updated_at_ms FROM owner_audit_reports WHERE intake_id=?').bind(id).first();
      // Explicitly select response fields: request fingerprints and payment attempt internals stay server-side.
      const fields = ['id','company_or_project','email','website_url','claim_scope','approximate_claims','why_it_matters','deadline','status','created_at_ms','scope_summary','scope_turnaround','scoped_price_usd','amount_due_usd','payment_state','payment_url','paid_at_ms','human_approved_at_ms','human_approved_by','report_url','report_delivered_at_ms','watch_started_at_ms','watch_ends_at_ms'];
      return json({ok:true,intake:Object.fromEntries(fields.map(k=>[k,row[k]??null])),notes:notes.results||[],activity:events.results||[],report});
    }
    if (request.method !== 'POST' || !action) return json({error:'method_not_allowed'},405);
    if (action === 'notes') {
      const note = clean(body.body,5000);
      if (!note) return json({error:'note_required'},400);
      await env.MONITOR_DB.prepare('INSERT INTO owner_audit_notes(id,intake_id,body,created_by,created_at_ms) VALUES(?,?,?,?,?)').bind(crypto.randomUUID(),id,note,actor,Date.now()).run();
      return json({ok:true},201);
    }
    if (action === 'report') {
      const report = typeof body.body === 'string' ? body.body.trim() : '';
      if (row.status !== 'paid') return json({error:'report_requires_paid_audit'},409);
      if (!report) return json({error:'report_required'},400);
      if (new TextEncoder().encode(report).byteLength > 480000) return json({error:'request_too_large'},413);
      const expected = body.expected_sha256 === null ? '' : clean(body.expected_sha256,64);
      if (body.expected_sha256 !== null && !/^[a-f0-9]{64}$/.test(expected)) return json({error:'report_revision_required'},400);
      const digest = [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(report)))].map(x=>x.toString(16).padStart(2,'0')).join('');
      // One atomic write. Database triggers invalidate review and reject edits after delivery.
      // A revision check prevents an older browser tab from overwriting a newer draft.
      const saved = await env.MONITOR_DB.prepare(`INSERT INTO owner_audit_reports(intake_id,body,sha256,updated_by,updated_at_ms)
        SELECT ?,?,?,?,? WHERE EXISTS (SELECT 1 FROM audit_intakes WHERE id=? AND status='paid')
        AND ((?='' AND NOT EXISTS (SELECT 1 FROM owner_audit_reports WHERE intake_id=?))
          OR EXISTS (SELECT 1 FROM owner_audit_reports WHERE intake_id=? AND sha256=?))
        ON CONFLICT(intake_id) DO UPDATE SET body=excluded.body,sha256=excluded.sha256,updated_by=excluded.updated_by,updated_at_ms=excluded.updated_at_ms
        RETURNING sha256`).bind(id,report,digest,actor,Date.now(),id,expected,id,id,expected).first();
      if (!saved) return json({error:'report_changed_refresh_review'},409);
      await recordEvent(env,id,'report_saved',actor);
      return json({ok:true,sha256:digest});
    }
    if (!env.PROOFTTL_ADMIN_TOKEN) return json({error:'owner_controls_not_configured'},503);
    let payload = body;
    if (action === 'scope') payload = {scope_summary:clean(body.scope_summary,5000),scope_turnaround:clean(body.scope_turnaround,180),price_usd:1500};
    if (action === 'approve' || action === 'deliver') {
      const report = await env.MONITOR_DB.prepare('SELECT sha256 FROM owner_audit_reports WHERE intake_id=?').bind(id).first();
      if (!report) return json({error:'save_report_before_review'},409);
      if (body.report_sha256 !== report.sha256) return json({error:'report_changed_refresh_review'},409);
      if (action === 'approve') {
        if (body.reviewed !== true) return json({error:'human_review_confirmation_required'},400);
        const approved = await env.MONITOR_DB.prepare(`UPDATE audit_intakes SET human_approved_at_ms=?,human_approved_by=?,report_sha256=?
          WHERE id=? AND status='paid' AND payment_state='paid'
          AND EXISTS(SELECT 1 FROM owner_audit_reports WHERE intake_id=? AND sha256=?) RETURNING id`).bind(Date.now(),actor,report.sha256,id,id,report.sha256).first();
        if (!approved) return json({error:'report_changed_or_audit_not_paid'},409);
        await recordEvent(env,id,'approve',actor);
        return json({ok:true,status:'paid'});
      } else {
        if (row.status === 'fulfilled' && row.report_sha256 === report.sha256) return json({ok:true,status:'fulfilled'});
        const reportUrl = `${String(env.PROOFTTL_WEB_URL).replace(/\/$/,'')}/audit/report/?request=${encodeURIComponent(id)}`;
        if (!reportUrl.startsWith('https://')) return json({error:'owner_controls_not_configured'},503);
        const now = Date.now(), watchEnds = now + 7*24*60*60*1000;
        const delivered = await env.MONITOR_DB.prepare(`UPDATE audit_intakes SET status='fulfilled',report_url=?,report_delivered_at_ms=?,watch_started_at_ms=?,watch_ends_at_ms=?,fulfilled_at_ms=?
          WHERE id=? AND status='paid' AND payment_state='paid' AND human_approved_at_ms IS NOT NULL AND report_sha256=?
          AND EXISTS(SELECT 1 FROM owner_audit_reports WHERE intake_id=? AND sha256=?) RETURNING id`).bind(reportUrl,now,now,watchEnds,now,id,report.sha256,id,report.sha256).first();
        if (!delivered) return json({error:'human_approval_required_before_fulfillment'},409);
        await recordEvent(env,id,'deliver',actor);
        return json({ok:true,status:'fulfilled',report_url:reportUrl,watch_ends_at_ms:watchEnds});
      }
    }
    const internal = new Request(`${new URL(request.url).origin}/admin/audit/intakes/${id}/${action}`,{method:'POST',headers:{authorization:`Bearer ${env.PROOFTTL_ADMIN_TOKEN}`,'content-type':'application/json'},body:JSON.stringify(payload)});
    const response = action === 'checkout' ? await createAuditCheckoutSession(internal,env,id) : await handleAuditAdmin(internal,env,`/admin/audit/intakes/${id}/${action}`);
    const result = await response.json();
    if (response.ok) await recordEvent(env,id,action,actor);
    return json(result,response.status);
  } catch (error) {
    console.error(JSON.stringify({event:'owner_desk_failed',error:error?.name||'Error'}));
    return json({error:'owner_service_unavailable',message:'Could not confirm the result. Refresh the request before retrying.'},503);
  }
}
async function recordEvent(env,id,action,actor) {
  try { await env.MONITOR_DB.prepare('INSERT INTO owner_audit_events(id,intake_id,action,actor,created_at_ms) VALUES(?,?,?,?,?)').bind(crypto.randomUUID(),id,action,actor,Date.now()).run(); }
  catch { console.warn(JSON.stringify({event:'owner_activity_record_failed',action})); }
}

export async function handlePrivateAuditReport(request,env,id) {
  if (request.method !== 'GET') return json({error:'method_not_allowed'},405);
  if (!ID.test(id)) return json({error:'not_found'},404);
  if (!env.MONITOR_DB) return json({error:'report_service_unavailable'},503);
  try {
  const session = await getOptionalProofTTLSession(request,env);
  if (!verified(session)) return json({error:'authentication_required'},401);
  const row = await env.MONITOR_DB.prepare(`SELECT a.id,a.company_or_project,a.email,a.status,a.human_approved_at_ms,a.report_delivered_at_ms,a.report_sha256,r.body,r.sha256 FROM audit_intakes a JOIN owner_audit_reports r ON r.intake_id=a.id WHERE a.id=?`).bind(id).first();
  if (!row || row.status !== 'fulfilled' || !row.human_approved_at_ms || !row.report_delivered_at_ms || row.sha256 !== row.report_sha256) return json({error:'report_not_available'},404);
  const link = await env.MONITOR_DB.prepare('SELECT 1 AS linked FROM account_audit_links WHERE user_id=? AND intake_id=? LIMIT 1').bind(session.user.id,id).first();
  const matchesEmail = String(session.user.email).trim().toLowerCase() === String(row.email).trim().toLowerCase();
  if (!isProofTTLOwnerSession(session) && !link?.linked && !matchesEmail) return json({error:'report_not_available'},404);
  return json({ok:true,report:{id:row.id,company:row.company_or_project,body:row.body,delivered_at_ms:row.report_delivered_at_ms,sha256:row.sha256}});
  } catch { return json({error:'report_service_unavailable'},503); }
}
