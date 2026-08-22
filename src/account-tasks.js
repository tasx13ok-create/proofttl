import { getOptionalProofTTLSession } from './auth.js';
import { isProofTTLOwnerSession } from './owner-access.js';

const PRIORITIES = new Set(['low', 'normal', 'high', 'urgent']);
const STATUSES = new Set(['open', 'done']);
const MAX_TASKS = 500;

export async function handleAccountTasks(request, env, pathname) {
  if (!env?.MONITOR_DB) return json({ error: 'task_storage_unavailable' }, 503);
  const session = await getOptionalProofTTLSession(request, env);
  const userId = session?.user?.id;
  if (!userId) return json({ error: 'authentication_required' }, 401);
  const owner = isProofTTLOwnerSession(session);

  if (pathname === '/account/tasks') {
    if (request.method === 'GET') return listTasks(request, env, userId, owner);
    if (request.method === 'POST') return createTask(request, env, userId, owner);
    return json({ error: 'method_not_allowed' }, 405, { allow: 'GET, POST, OPTIONS' });
  }

  const match = pathname.match(/^\/account\/tasks\/(tsk_[a-f0-9]{32})$/);
  if (!match) return json({ error: 'not_found' }, 404);
  if (request.method === 'PATCH') return updateTask(request, env, userId, match[1]);
  if (request.method === 'DELETE') return deleteTask(env, userId, match[1]);
  return json({ error: 'method_not_allowed' }, 405, { allow: 'PATCH, DELETE, OPTIONS' });
}

async function listTasks(request, env, userId, owner) {
  const url = new URL(request.url);
  const requestedStatus = clean(url.searchParams.get('status'), 20).toLowerCase();
  const status = STATUSES.has(requestedStatus) ? requestedStatus : null;
  let result;
  if (owner) {
    result = status
      ? await env.MONITOR_DB.prepare(`SELECT * FROM account_tasks WHERE user_id=? AND status=? ORDER BY CASE priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END, COALESCE(due_at,'9999'), updated_at DESC`).bind(userId,status).all()
      : await env.MONITOR_DB.prepare(`SELECT * FROM account_tasks WHERE user_id=? ORDER BY CASE status WHEN 'open' THEN 0 ELSE 1 END, CASE priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END, COALESCE(due_at,'9999'), updated_at DESC`).bind(userId).all();
  } else {
    result = status
      ? await env.MONITOR_DB.prepare(`SELECT * FROM account_tasks WHERE user_id=? AND status=? ORDER BY CASE priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END, COALESCE(due_at,'9999'), updated_at DESC LIMIT ?`).bind(userId,status,MAX_TASKS).all()
      : await env.MONITOR_DB.prepare(`SELECT * FROM account_tasks WHERE user_id=? ORDER BY CASE status WHEN 'open' THEN 0 ELSE 1 END, CASE priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END, COALESCE(due_at,'9999'), updated_at DESC LIMIT ?`).bind(userId,MAX_TASKS).all();
  }
  return json({ tasks: result.results || [], limits: { max_tasks: owner ? null : MAX_TASKS, unlimited_task_count: owner } });
}

async function createTask(request, env, userId, owner) {
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object') return json({ error: 'invalid_json' }, 400);
  if (!owner) {
    const count = await env.MONITOR_DB.prepare('SELECT COUNT(*) AS count FROM account_tasks WHERE user_id=?').bind(userId).first();
    if (Number(count?.count || 0) >= MAX_TASKS) return json({ error: 'task_limit_reached', max_tasks: MAX_TASKS }, 409);
  }

  const normalized = normalizeTask(body);
  if (!normalized.ok) return json({ error: normalized.error }, 400);
  const taskId = `tsk_${crypto.randomUUID().replaceAll('-', '')}`;
  const now = new Date().toISOString();
  await env.MONITOR_DB.prepare(`INSERT INTO account_tasks (task_id,user_id,title,notes,priority,status,due_at,source,created_at,updated_at,completed_at)
    VALUES (?,?,?,?,?,'open',?,'proofttl-native',?,?,NULL)`).bind(taskId,userId,normalized.title,normalized.notes,normalized.priority,normalized.dueAt,now,now).run();
  return json({ task: { task_id: taskId, title: normalized.title, notes: normalized.notes, priority: normalized.priority, status: 'open', due_at: normalized.dueAt, source: 'proofttl-native', created_at: now, updated_at: now, completed_at: null } }, 201);
}

async function updateTask(request, env, userId, taskId) {
  const row = await env.MONITOR_DB.prepare('SELECT * FROM account_tasks WHERE task_id=? AND user_id=?').bind(taskId,userId).first();
  if (!row) return json({ error: 'task_not_found' }, 404);
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object') return json({ error: 'invalid_json' }, 400);

  const title = body.title === undefined ? row.title : clean(body.title, 220);
  if (!title) return json({ error: 'title_required' }, 400);
  const notes = body.notes === undefined ? row.notes : clean(body.notes, 3000) || null;
  const priority = body.priority === undefined ? row.priority : clean(body.priority, 20).toLowerCase();
  if (!PRIORITIES.has(priority)) return json({ error: 'invalid_priority' }, 400);
  const status = body.status === undefined ? row.status : clean(body.status, 20).toLowerCase();
  if (!STATUSES.has(status)) return json({ error: 'invalid_status' }, 400);
  const dueAt = body.due_at === undefined ? row.due_at : normalizeDate(body.due_at);
  if (body.due_at && !dueAt) return json({ error: 'invalid_due_at' }, 400);
  const now = new Date().toISOString();
  const completedAt = status === 'done' ? row.completed_at || now : null;

  await env.MONITOR_DB.prepare('UPDATE account_tasks SET title=?,notes=?,priority=?,status=?,due_at=?,updated_at=?,completed_at=? WHERE task_id=? AND user_id=?')
    .bind(title,notes,priority,status,dueAt,now,completedAt,taskId,userId).run();
  return json({ task: { task_id: taskId, title, notes, priority, status, due_at: dueAt, source: row.source, created_at: row.created_at, updated_at: now, completed_at: completedAt } });
}

async function deleteTask(env, userId, taskId) {
  await env.MONITOR_DB.prepare('DELETE FROM account_tasks WHERE task_id=? AND user_id=?').bind(taskId,userId).run();
  return new Response(null, { status: 204, headers: { 'cache-control': 'no-store' } });
}

function normalizeTask(body) {
  const title = clean(body?.title, 220);
  if (!title) return { ok: false, error: 'title_required' };
  const notes = clean(body?.notes, 3000) || null;
  const priority = clean(body?.priority || 'normal', 20).toLowerCase();
  if (!PRIORITIES.has(priority)) return { ok: false, error: 'invalid_priority' };
  const dueAt = normalizeDate(body?.due_at);
  if (body?.due_at && !dueAt) return { ok: false, error: 'invalid_due_at' };
  return { ok: true, title, notes, priority, dueAt };
}
function normalizeDate(value) {
  if (value === undefined || value === null || value === '') return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}
function clean(value, max) { return typeof value === 'string' ? value.trim().slice(0, max) : ''; }
function json(body, status = 200, extra = {}) { return Response.json(body, { status, headers: { 'cache-control': 'no-store', ...extra } }); }
