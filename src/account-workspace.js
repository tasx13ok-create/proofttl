import { getOptionalProofTTLSession } from "./auth.js";

const MAX_PROJECT_BYTES = 200 * 1024;
const MAX_PROJECTS = 25;

export async function handleAccountWorkspace(request, env, pathname) {
  if (!env?.MONITOR_DB) return json({ error: "account_storage_unavailable" }, 503);
  const session = await getOptionalProofTTLSession(request, env);
  const userId = session?.user?.id;
  const userEmail = normalizeEmail(session?.user?.email);
  if (!userId) return json({ error: "authentication_required", message: "Sign in to use account-owned workspace data." }, 401);

  if (pathname === "/account/preferences") {
    if (request.method === "GET") return getPreferences(env, userId);
    if (request.method === "PATCH") return updatePreferences(request, env, userId);
    return json({ error: "method_not_allowed" }, 405, { allow: "GET, PATCH, OPTIONS" });
  }

  if (pathname === "/account/audits") {
    if (request.method === "GET") return listAccountAudits(env, userId);
    if (request.method === "POST") return linkAudit(request, env, userId, userEmail);
    return json({ error: "method_not_allowed" }, 405, { allow: "GET, POST, OPTIONS" });
  }

  if (pathname === "/studio/projects") {
    if (request.method === "GET") return listProjects(env, userId);
    if (request.method === "POST") return saveProject(request, env, userId);
    return json({ error: "method_not_allowed" }, 405, { allow: "GET, POST, OPTIONS" });
  }

  const match = pathname.match(/^\/studio\/projects\/(prj_[a-f0-9]{32})$/);
  if (match) {
    if (request.method === "GET") return getProject(env, userId, match[1]);
    if (request.method === "PUT") return saveProject(request, env, userId, match[1]);
    if (request.method === "DELETE") return deleteProject(env, userId, match[1]);
    return json({ error: "method_not_allowed" }, 405, { allow: "GET, PUT, DELETE, OPTIONS" });
  }

  return json({ error: "not_found" }, 404);
}

async function getPreferences(env, userId) {
  const row = await env.MONITOR_DB.prepare("SELECT * FROM account_preferences WHERE user_id=?").bind(userId).first();
  return json({ preferences: row ? publicPreferences(row) : defaults() });
}

async function updatePreferences(request, env, userId) {
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") return json({ error: "invalid_json" }, 400);
  const current = { ...defaults(), ...(await env.MONITOR_DB.prepare("SELECT * FROM account_preferences WHERE user_id=?").bind(userId).first() || {}) };
  const next = {
    preferred_ai_provider: cleanOptional(body.preferred_ai_provider ?? current.preferred_ai_provider, 80),
    preferred_ai_model: cleanOptional(body.preferred_ai_model ?? current.preferred_ai_model, 160),
    love_voice_enabled: boolInt(body.love_voice_enabled ?? current.love_voice_enabled),
    love_compact_mode: boolInt(body.love_compact_mode ?? current.love_compact_mode),
    studio_autosave: boolInt(body.studio_autosave ?? current.studio_autosave),
  };
  const now = new Date().toISOString();
  await env.MONITOR_DB.prepare(`INSERT INTO account_preferences (user_id,preferred_ai_provider,preferred_ai_model,love_voice_enabled,love_compact_mode,studio_autosave,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET preferred_ai_provider=excluded.preferred_ai_provider,preferred_ai_model=excluded.preferred_ai_model,love_voice_enabled=excluded.love_voice_enabled,love_compact_mode=excluded.love_compact_mode,studio_autosave=excluded.studio_autosave,updated_at=excluded.updated_at`)
    .bind(userId,next.preferred_ai_provider,next.preferred_ai_model,next.love_voice_enabled,next.love_compact_mode,next.studio_autosave,now,now).run();
  return json({ preferences: publicPreferences(next) });
}

async function listAccountAudits(env, userId) {
  const rows = await env.MONITOR_DB.prepare(`SELECT a.intake_id,a.offer_type,a.company_project,a.website,a.approximate_claims,a.status,a.amount_due_cents,a.amount_paid_cents,a.payment_provider,a.created_at,a.updated_at,a.paid_at,a.fulfilled_at
    FROM account_audit_links l JOIN audit_intakes a ON a.intake_id=l.intake_id
    WHERE l.user_id=? ORDER BY a.updated_at DESC LIMIT 50`).bind(userId).all();
  return json({ audits: rows.results || [] });
}

async function linkAudit(request, env, userId, userEmail) {
  if (!userEmail) return json({ error: "verified_email_required", message: "Your sign-in provider must supply an email before an audit can be linked." }, 400);
  const body = await request.json().catch(() => null);
  const intakeId = clean(body?.intake_id, 64).toLowerCase();
  if (!/^ati_[a-f0-9]{32}$/.test(intakeId)) return json({ error: "invalid_intake_id" }, 400);
  const intake = await env.MONITOR_DB.prepare("SELECT intake_id,email FROM audit_intakes WHERE intake_id=?").bind(intakeId).first();
  if (!intake) return json({ error: "audit_not_found" }, 404);
  if (normalizeEmail(intake.email) !== userEmail) return json({ error: "audit_ownership_mismatch", message: "This audit was submitted under a different email address." }, 403);
  await env.MONITOR_DB.prepare("INSERT OR IGNORE INTO account_audit_links (user_id,intake_id,created_at) VALUES (?,?,?)").bind(userId,intakeId,new Date().toISOString()).run();
  return json({ linked: true, intake_id: intakeId }, 201);
}

async function listProjects(env, userId) {
  const rows = await env.MONITOR_DB.prepare("SELECT project_id,name,language,active_file,created_at,updated_at FROM studio_projects WHERE user_id=? ORDER BY updated_at DESC LIMIT ?").bind(userId, MAX_PROJECTS).all();
  return json({ projects: rows.results || [] });
}

async function getProject(env, userId, projectId) {
  const row = await env.MONITOR_DB.prepare("SELECT * FROM studio_projects WHERE user_id=? AND project_id=?").bind(userId, projectId).first();
  if (!row) return json({ error: "project_not_found" }, 404);
  return json({ project: { ...row, files: safeJson(row.files_json, {}), files_json: undefined } });
}

async function saveProject(request, env, userId, forcedId = null) {
  const raw = await request.text();
  if (new TextEncoder().encode(raw).byteLength > MAX_PROJECT_BYTES) return json({ error: "project_too_large", max_bytes: MAX_PROJECT_BYTES }, 413);
  let body; try { body = JSON.parse(raw); } catch { return json({ error: "invalid_json" }, 400); }
  const files = body?.files && typeof body.files === "object" && !Array.isArray(body.files) ? body.files : null;
  if (!files || !Object.keys(files).length) return json({ error: "files_required" }, 400);
  if (Object.keys(files).length > 50) return json({ error: "too_many_files", max_files: 50 }, 400);
  for (const [name, content] of Object.entries(files)) {
    if (!validFileName(name) || typeof content !== "string" || content.length > 50000) return json({ error: "invalid_project_file" }, 400);
  }
  const projectId = forcedId || `prj_${crypto.randomUUID().replaceAll("-", "")}`;
  const now = new Date().toISOString();
  const name = clean(body.name || "Untitled project", 120) || "Untitled project";
  const language = cleanOptional(body.language, 40);
  const activeFile = cleanOptional(body.active_file, 200);
  await env.MONITOR_DB.prepare(`INSERT INTO studio_projects (project_id,user_id,name,language,files_json,active_file,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(project_id) DO UPDATE SET name=excluded.name,language=excluded.language,files_json=excluded.files_json,active_file=excluded.active_file,updated_at=excluded.updated_at WHERE studio_projects.user_id=excluded.user_id`)
    .bind(projectId,userId,name,language,JSON.stringify(files),activeFile,now,now).run();
  return json({ project: { project_id: projectId, name, language, active_file: activeFile, files, updated_at: now } }, forcedId ? 200 : 201);
}

async function deleteProject(env, userId, projectId) {
  await env.MONITOR_DB.prepare("DELETE FROM studio_projects WHERE user_id=? AND project_id=?").bind(userId, projectId).run();
  return new Response(null, { status: 204, headers: { "cache-control": "no-store" } });
}

function defaults(){ return { preferred_ai_provider:null, preferred_ai_model:null, love_voice_enabled:1, love_compact_mode:0, studio_autosave:1 }; }
function publicPreferences(row){ return { preferred_ai_provider: row.preferred_ai_provider || null, preferred_ai_model: row.preferred_ai_model || null, love_voice_enabled:Boolean(row.love_voice_enabled), love_compact_mode:Boolean(row.love_compact_mode), studio_autosave:Boolean(row.studio_autosave) }; }
function boolInt(v){ return v === false || v === 0 ? 0 : 1; }
function clean(v,n){ return typeof v === "string" ? v.trim().slice(0,n) : ""; }
function cleanOptional(v,n){ const x=clean(v,n); return x || null; }
function normalizeEmail(v){ return typeof v === "string" ? v.trim().toLowerCase() : ""; }
function validFileName(v){ return typeof v === "string" && v.length>0 && v.length<=200 && !v.includes("..") && !v.startsWith("/") && !v.includes("\\"); }
function safeJson(v,fallback){ try{return JSON.parse(v)}catch{return fallback} }
function json(body,status=200,extra={}){ return new Response(JSON.stringify(body),{status,headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store",...extra}}); }
