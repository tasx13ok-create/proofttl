import { getOptionalProofTTLSession } from './auth.js';
import { actionPolicy } from './capability-registry.js';

const MAX_INPUT_CHARS = 5000;
const TRIGGERS = new Set(['schedule', 'condition', 'manual']);

export async function handleAccountAutomations(request, env, pathname) {
  if (!env?.MONITOR_DB) return json({ error: 'automation_storage_unavailable' }, 503);
  const session = await getOptionalProofTTLSession(request, env);
  const userId = session?.user?.id;
  if (!userId) return json({ error: 'authentication_required' }, 401);

  if (pathname === '/account/automations') {
    if (request.method === 'GET') return listAutomations(env, userId);
    if (request.method === 'POST') return createAutomation(request, env, userId);
    return json({ error: 'method_not_allowed' }, 405, { allow: 'GET, POST, OPTIONS' });
  }

  const match = pathname.match(/^\/account\/automations\/(aut_[a-f0-9]{32})$/);
  if (!match) return json({ error: 'not_found' }, 404);
  if (request.method === 'PATCH') return updateAutomation(request, env, userId, match[1]);
  if (request.method === 'DELETE') return deleteAutomation(env, userId, match[1]);
  return json({ error: 'method_not_allowed' }, 405, { allow: 'PATCH, DELETE, OPTIONS' });
}

async function listAutomations(env, userId) {
  const rows = await env.MONITOR_DB.prepare(`SELECT automation_id,name,trigger_type,schedule_expr,condition_summary,action_id,risk,confirmation_mode,enabled,created_at,updated_at,last_run_at,last_run_state
    FROM account_automations WHERE user_id=? ORDER BY updated_at DESC LIMIT 100`).bind(userId).all();
  return json({ automations: rows.results || [], execution: { connected: false, note: 'Definitions are stored; capability-specific automation execution is not connected yet.' } });
}

async function createAutomation(request, env, userId) {
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object') return json({ error: 'invalid_json' }, 400);
  const name = clean(body.name, 120);
  const triggerType = clean(body.trigger_type, 30).toLowerCase();
  const actionId = clean(body.action_id, 120);
  const policy = actionPolicy(actionId);
  if (!name) return json({ error: 'name_required' }, 400);
  if (!TRIGGERS.has(triggerType)) return json({ error: 'invalid_trigger_type' }, 400);
  if (!policy) return json({ error: 'unknown_action' }, 400);

  const scheduleExpr = triggerType === 'schedule' ? clean(body.schedule_expr, 300) : null;
  const conditionSummary = triggerType === 'condition' ? clean(body.condition_summary, 600) : null;
  if (triggerType === 'schedule' && !scheduleExpr) return json({ error: 'schedule_required' }, 400);
  if (triggerType === 'condition' && !conditionSummary) return json({ error: 'condition_required' }, 400);

  const actionInput = sanitizeInput(body.action_input);
  const confirmationMode = policy.explicit_confirmation_required ? 'per_run_explicit' : 'policy_default';
  const requestedEnabled = body.enabled === true;
  const enabled = requestedEnabled && !policy.explicit_confirmation_required ? 1 : 0;
  const automationId = `aut_${crypto.randomUUID().replaceAll('-', '')}`;
  const now = new Date().toISOString();

  await env.MONITOR_DB.prepare(`INSERT INTO account_automations (
    automation_id,user_id,name,trigger_type,schedule_expr,condition_summary,action_id,action_input_json,risk,confirmation_mode,enabled,created_at,updated_at
  ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(
    automationId,userId,name,triggerType,scheduleExpr,conditionSummary,actionId,actionInput,policy.risk,confirmationMode,enabled,now,now
  ).run();

  return json({
    automation: { automation_id: automationId, name, trigger_type: triggerType, schedule_expr: scheduleExpr, condition_summary: conditionSummary, action_id: actionId, risk: policy.risk, confirmation_mode: confirmationMode, enabled: Boolean(enabled) },
    execution: { connected: false },
    warning: policy.explicit_confirmation_required && requestedEnabled ? 'Sensitive automations cannot be pre-enabled for unattended execution.' : null
  }, 201);
}

async function updateAutomation(request, env, userId, automationId) {
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object') return json({ error: 'invalid_json' }, 400);
  const row = await env.MONITOR_DB.prepare('SELECT * FROM account_automations WHERE automation_id=? AND user_id=?').bind(automationId, userId).first();
  if (!row) return json({ error: 'automation_not_found' }, 404);

  const policy = actionPolicy(row.action_id);
  if (!policy) return json({ error: 'automation_action_no_longer_supported' }, 409);
  const name = body.name === undefined ? row.name : clean(body.name, 120);
  if (!name) return json({ error: 'name_required' }, 400);
  const enabled = body.enabled === undefined ? Number(row.enabled || 0) : body.enabled === true ? 1 : 0;
  if (enabled && policy.explicit_confirmation_required) return json({ error: 'sensitive_automation_cannot_run_unattended' }, 409);
  const scheduleExpr = body.schedule_expr === undefined ? row.schedule_expr : clean(body.schedule_expr, 300) || null;
  const conditionSummary = body.condition_summary === undefined ? row.condition_summary : clean(body.condition_summary, 600) || null;
  const now = new Date().toISOString();

  await env.MONITOR_DB.prepare('UPDATE account_automations SET name=?,schedule_expr=?,condition_summary=?,enabled=?,updated_at=? WHERE automation_id=? AND user_id=?')
    .bind(name,scheduleExpr,conditionSummary,enabled,now,automationId,userId).run();
  return json({ automation: { automation_id: automationId, name, action_id: row.action_id, risk: row.risk, confirmation_mode: row.confirmation_mode, enabled: Boolean(enabled), updated_at: now }, execution: { connected: false } });
}

async function deleteAutomation(env, userId, automationId) {
  await env.MONITOR_DB.prepare('DELETE FROM account_automations WHERE automation_id=? AND user_id=?').bind(automationId,userId).run();
  return new Response(null, { status: 204, headers: { 'cache-control': 'no-store' } });
}

function sanitizeInput(value) {
  if (value === undefined || value === null) return null;
  const raw = JSON.stringify(value);
  if (raw.length > MAX_INPUT_CHARS) throw new Error('automation_input_too_large');
  return raw.replace(/("?(?:secret|token|password|api[_-]?key)"?\s*:\s*)"[^"]*"/gi, '$1"[redacted]"');
}
function clean(value, max) { return typeof value === 'string' ? value.trim().slice(0, max) : ''; }
function json(body, status = 200, extra = {}) { return Response.json(body, { status, headers: { 'cache-control': 'no-store', ...extra } }); }
