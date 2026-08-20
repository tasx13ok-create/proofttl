import { getOptionalProofTTLSession } from './auth.js';
import { planCapabilityAction } from './capability-registry.js';

const MAX_SUMMARY = 800;
const VALID_STATES = new Set(['planned', 'awaiting_confirmation', 'authorized', 'executing', 'succeeded', 'failed', 'cancelled']);

export async function handleActionPlan(request, env) {
  if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405, { allow: 'POST, OPTIONS' });
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object') return json({ error: 'invalid_json' }, 400);

  const plan = planCapabilityAction(body);
  if (!plan.ok) return json(plan, 400);

  const session = await getOptionalProofTTLSession(request, env);
  const userId = session?.user?.id || null;
  const now = new Date().toISOString();
  const receiptId = `act_${crypto.randomUUID().replaceAll('-', '')}`;
  const state = plan.confirmation_required ? 'awaiting_confirmation' : 'authorized';
  const inputSummary = cleanSummary(body.input_summary);

  if (userId && env?.MONITOR_DB) {
    await env.MONITOR_DB.prepare(`INSERT INTO action_receipts (
      receipt_id,user_id,action_id,area,risk,confirmation_required,confirmed,state,input_summary,created_at,updated_at
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?)`).bind(
      receiptId,
      userId,
      plan.policy.action_id,
      plan.policy.area,
      plan.policy.risk,
      plan.confirmation_required ? 1 : 0,
      body.confirmed === true ? 1 : 0,
      state,
      inputSummary,
      now,
      now
    ).run();
  }

  return json({
    ...plan,
    receipt: {
      receipt_id: receiptId,
      persisted: Boolean(userId && env?.MONITOR_DB),
      state,
      user_scoped: Boolean(userId)
    }
  });
}

export async function handleAccountActions(request, env, pathname) {
  if (!env?.MONITOR_DB) return json({ error: 'action_storage_unavailable' }, 503);
  const session = await getOptionalProofTTLSession(request, env);
  const userId = session?.user?.id;
  if (!userId) return json({ error: 'authentication_required' }, 401);

  if (pathname === '/account/actions' && request.method === 'GET') {
    const rows = await env.MONITOR_DB.prepare(`SELECT receipt_id,action_id,area,risk,confirmation_required,confirmed,state,provider,input_summary,result_summary,error_code,created_at,updated_at,completed_at
      FROM action_receipts WHERE user_id=? ORDER BY updated_at DESC LIMIT 100`).bind(userId).all();
    return json({ actions: rows.results || [] });
  }

  const match = pathname.match(/^\/account\/actions\/(act_[a-f0-9]{32})$/);
  if (match && request.method === 'PATCH') return updateActionReceipt(request, env, userId, match[1]);

  return json({ error: 'not_found' }, 404);
}

async function updateActionReceipt(request, env, userId, receiptId) {
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object') return json({ error: 'invalid_json' }, 400);
  const row = await env.MONITOR_DB.prepare('SELECT * FROM action_receipts WHERE receipt_id=? AND user_id=?').bind(receiptId, userId).first();
  if (!row) return json({ error: 'action_receipt_not_found' }, 404);

  const nextState = typeof body.state === 'string' ? body.state.trim().toLowerCase() : row.state;
  if (!VALID_STATES.has(nextState)) return json({ error: 'invalid_action_state' }, 400);

  if (row.risk === 'sensitive' && ['authorized', 'executing', 'succeeded'].includes(nextState) && !row.confirmed && body.confirmed !== true) {
    return json({ error: 'explicit_confirmation_required' }, 409);
  }

  const confirmed = row.confirmed || body.confirmed === true ? 1 : 0;
  const provider = clean(body.provider, 120) || row.provider || null;
  const resultSummary = cleanSummary(body.result_summary) || row.result_summary || null;
  const errorCode = clean(body.error_code, 120) || null;
  const now = new Date().toISOString();
  const completedAt = ['succeeded', 'failed', 'cancelled'].includes(nextState) ? now : row.completed_at || null;

  await env.MONITOR_DB.prepare(`UPDATE action_receipts SET state=?,confirmed=?,provider=?,result_summary=?,error_code=?,updated_at=?,completed_at=? WHERE receipt_id=? AND user_id=?`)
    .bind(nextState, confirmed, provider, resultSummary, errorCode, now, completedAt, receiptId, userId).run();

  return json({
    receipt: {
      receipt_id: receiptId,
      action_id: row.action_id,
      area: row.area,
      risk: row.risk,
      state: nextState,
      confirmed: Boolean(confirmed),
      provider,
      result_summary: resultSummary,
      error_code: errorCode,
      updated_at: now,
      completed_at: completedAt
    }
  });
}

function clean(value, max) { return typeof value === 'string' ? value.trim().slice(0, max) : ''; }
function cleanSummary(value) {
  const text = clean(value, MAX_SUMMARY);
  return text ? text.replace(/(?:sk|pk|secret|token|password|api[_-]?key)\s*[:=]\s*\S+/gi, '[redacted]') : null;
}
function json(body, status = 200, extra = {}) {
  return Response.json(body, { status, headers: { 'cache-control': 'no-store', ...extra } });
}
