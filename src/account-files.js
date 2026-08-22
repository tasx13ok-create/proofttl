import { getOptionalProofTTLSession } from './auth.js';
import { isProofTTLOwnerSession } from './owner-access.js';

const MAX_FILE_BYTES = 200 * 1024;
const MAX_FILES = 100;
const ALLOWED_MEDIA_TYPES = new Set([
  'text/plain',
  'text/markdown',
  'application/json',
  'text/javascript',
  'text/typescript',
  'text/x-python',
  'text/x-powershell',
  'text/x-shellscript',
  'text/html',
  'text/css'
]);

export async function handleAccountFiles(request, env, pathname) {
  if (!env?.MONITOR_DB) return json({ error: 'file_storage_unavailable' }, 503);
  const session = await getOptionalProofTTLSession(request, env);
  const userId = session?.user?.id;
  if (!userId) return json({ error: 'authentication_required' }, 401);
  const owner = isProofTTLOwnerSession(session);

  if (pathname === '/account/files') {
    if (request.method === 'GET') return listFiles(env, userId, owner);
    if (request.method === 'POST') return createFile(request, env, userId, owner);
    return json({ error: 'method_not_allowed' }, 405, { allow: 'GET, POST, OPTIONS' });
  }

  const match = pathname.match(/^\/account\/files\/(fil_[a-f0-9]{32})$/);
  if (!match) return json({ error: 'not_found' }, 404);
  if (request.method === 'GET') return getFile(env, userId, match[1]);
  if (request.method === 'PATCH') return updateFile(request, env, userId, match[1]);
  if (request.method === 'DELETE') return deleteFile(env, userId, match[1]);
  return json({ error: 'method_not_allowed' }, 405, { allow: 'GET, PATCH, DELETE, OPTIONS' });
}

async function listFiles(env, userId, owner) {
  const rows = owner
    ? await env.MONITOR_DB.prepare(`SELECT file_id,name,media_type,size_bytes,source,created_at,updated_at
        FROM account_files WHERE user_id=? ORDER BY updated_at DESC`).bind(userId).all()
    : await env.MONITOR_DB.prepare(`SELECT file_id,name,media_type,size_bytes,source,created_at,updated_at
        FROM account_files WHERE user_id=? ORDER BY updated_at DESC LIMIT ?`).bind(userId, MAX_FILES).all();
  return json({ files: rows.results || [], limits: { max_files: owner ? null : MAX_FILES, max_file_bytes: MAX_FILE_BYTES, unlimited_file_count: owner } });
}

async function getFile(env, userId, fileId) {
  const row = await env.MONITOR_DB.prepare('SELECT * FROM account_files WHERE file_id=? AND user_id=?').bind(fileId, userId).first();
  if (!row) return json({ error: 'file_not_found' }, 404);
  return json({ file: row });
}

async function createFile(request, env, userId, owner) {
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object') return json({ error: 'invalid_json' }, 400);
  if (!owner) {
    const count = await env.MONITOR_DB.prepare('SELECT COUNT(*) AS count FROM account_files WHERE user_id=?').bind(userId).first();
    if (Number(count?.count || 0) >= MAX_FILES) return json({ error: 'file_limit_reached', max_files: MAX_FILES }, 409);
  }

  const normalized = normalizeFileInput(body);
  if (!normalized.ok) return json(normalized.error, normalized.status);
  const fileId = `fil_${crypto.randomUUID().replaceAll('-', '')}`;
  const now = new Date().toISOString();
  await env.MONITOR_DB.prepare(`INSERT INTO account_files (file_id,user_id,name,media_type,content_text,size_bytes,source,created_at,updated_at)
    VALUES (?,?,?,?,?,?, 'proofttl-native', ?,?)`).bind(fileId,userId,normalized.name,normalized.mediaType,normalized.content,normalized.sizeBytes,now,now).run();
  return json({ file: { file_id: fileId, name: normalized.name, media_type: normalized.mediaType, content_text: normalized.content, size_bytes: normalized.sizeBytes, source: 'proofttl-native', created_at: now, updated_at: now } }, 201);
}

async function updateFile(request, env, userId, fileId) {
  const row = await env.MONITOR_DB.prepare('SELECT * FROM account_files WHERE file_id=? AND user_id=?').bind(fileId,userId).first();
  if (!row) return json({ error: 'file_not_found' }, 404);
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object') return json({ error: 'invalid_json' }, 400);
  const normalized = normalizeFileInput({
    name: body.name === undefined ? row.name : body.name,
    media_type: body.media_type === undefined ? row.media_type : body.media_type,
    content: body.content === undefined ? row.content_text : body.content,
  });
  if (!normalized.ok) return json(normalized.error, normalized.status);
  const now = new Date().toISOString();
  await env.MONITOR_DB.prepare('UPDATE account_files SET name=?,media_type=?,content_text=?,size_bytes=?,updated_at=? WHERE file_id=? AND user_id=?')
    .bind(normalized.name,normalized.mediaType,normalized.content,normalized.sizeBytes,now,fileId,userId).run();
  return json({ file: { file_id: fileId, name: normalized.name, media_type: normalized.mediaType, content_text: normalized.content, size_bytes: normalized.sizeBytes, source: row.source, created_at: row.created_at, updated_at: now } });
}

async function deleteFile(env, userId, fileId) {
  await env.MONITOR_DB.prepare('DELETE FROM account_files WHERE file_id=? AND user_id=?').bind(fileId,userId).run();
  return new Response(null, { status: 204, headers: { 'cache-control': 'no-store' } });
}

function normalizeFileInput(body) {
  const name = cleanName(body?.name);
  const mediaType = typeof body?.media_type === 'string' ? body.media_type.trim().toLowerCase() : 'text/plain';
  const content = typeof body?.content === 'string' ? body.content.replace(/\u0000/g, '') : null;
  if (!name) return { ok: false, status: 400, error: { error: 'valid_file_name_required' } };
  if (!ALLOWED_MEDIA_TYPES.has(mediaType)) return { ok: false, status: 415, error: { error: 'unsupported_file_type' } };
  if (content === null) return { ok: false, status: 400, error: { error: 'file_content_required' } };
  const sizeBytes = new TextEncoder().encode(content).byteLength;
  if (sizeBytes > MAX_FILE_BYTES) return { ok: false, status: 413, error: { error: 'file_too_large', max_file_bytes: MAX_FILE_BYTES } };
  return { ok: true, name, mediaType, content, sizeBytes };
}
function cleanName(value) {
  if (typeof value !== 'string') return '';
  const name = value.trim().replace(/^\/+/, '').slice(0, 160);
  if (!name || name.includes('..') || name.includes('\\') || name.includes('/')) return '';
  return name;
}
function json(body, status = 200, extra = {}) { return Response.json(body, { status, headers: { 'cache-control': 'no-store', ...extra } }); }
