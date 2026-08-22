import { getOptionalProofTTLSession } from "./auth.js";
import { assistantModelRuntime, assistantResponseProviderAvailable, runAssistantResponse } from "./assistant-model-router.js";

const MAX_OBJECTIVE_CHARS = 2000;
const MAX_RUNS = 20;
const MAX_CANDIDATES = 80;
const DEFAULT_MAX_ROUNDS = 5;
const MAX_MAX_ROUNDS = 12;

const FOUNDRY_SYSTEM = [
  "You are ProofTTL Foundry, an adversarial business-opportunity search engine.",
  "RUN ISOLATION: ignore prior conversation context, prior founder preferences, ProofTTL product assumptions, and old constraints unless they appear in the objective supplied in this request.",
  "ANTI-ANCHORING: do not prefer fact checking, provenance, AI verification, or ProofTTL-adjacent ideas merely because the host product is ProofTTL.",
  "Optimize for risk-adjusted founder value, not novelty or impressive prose.",
  "Problem-first: real economic pain -> identifiable buyer -> existing spend/loss -> solution -> distribution -> economics.",
  "An ordinary pain point is not enough. Search for asymmetry: recent technology, regulation, pricing discontinuity, new dataset/API, labor shift, incumbent conflict, or another structural reason a small entrant can win now.",
  "Treat AI as a capability, not a moat or business model.",
  "Aggressively kill weak ideas. Never protect an idea because it sounds exciting.",
  "Do not claim web research, customer interviews, simulations, or evidence that was not actually supplied. Mark unsupported market facts as hypotheses.",
  "Return strict JSON only. No Markdown fences or commentary outside JSON."
].join(" ");

export async function handleFoundry(request, env, pathname) {
  if (!env?.MONITOR_DB) return json({ error: "foundry_storage_unavailable" }, 503);
  const session = await getOptionalProofTTLSession(request, env);
  const userId = session?.user?.id;
  if (!userId) return json({ error: "authentication_required", message: "Sign in to use Foundry." }, 401);

  if (pathname === "/foundry/runs") {
    if (request.method === "GET") return listRuns(env, userId);
    if (request.method === "POST") return createRun(request, env, userId);
    return json({ error: "method_not_allowed" }, 405, { allow: "GET, POST, OPTIONS" });
  }

  const runMatch = pathname.match(/^\/foundry\/runs\/(fdr_[a-f0-9]{32})$/);
  if (runMatch) {
    if (request.method === "GET") return getRun(env, userId, runMatch[1]);
    return json({ error: "method_not_allowed" }, 405, { allow: "GET, OPTIONS" });
  }

  const stepMatch = pathname.match(/^\/foundry\/runs\/(fdr_[a-f0-9]{32})\/step$/);
  if (stepMatch) {
    if (request.method === "POST") return stepRun(request, env, userId, stepMatch[1]);
    return json({ error: "method_not_allowed" }, 405, { allow: "POST, OPTIONS" });
  }

  return json({ error: "not_found" }, 404);
}

async function createRun(request, env, userId) {
  if (!assistantResponseProviderAvailable(env)) return json({ error: "foundry_model_unavailable" }, 503);
  const body = await request.json().catch(() => null);
  const objective = clean(body?.objective, MAX_OBJECTIVE_CHARS);
  if (!objective) return json({ error: "objective_required" }, 400);
  const maxRounds = clampInt(body?.max_rounds, 1, MAX_MAX_ROUNDS, DEFAULT_MAX_ROUNDS);
  const runId = `fdr_${crypto.randomUUID().replaceAll("-", "")}`;
  const now = new Date().toISOString();
  await env.MONITOR_DB.prepare(`INSERT INTO foundry_runs
    (run_id,user_id,objective,status,stage,rounds_completed,max_rounds,model_calls,created_at,updated_at)
    VALUES (?,?,?,'running','discover',0,?,0,?,?)`)
    .bind(runId, userId, objective, maxRounds, now, now).run();
  await addEvent(env, runId, "run_started", "Foundry run created. Discovery has not been executed yet.", { max_rounds: maxRounds });
  return json({ run: await loadRun(env, userId, runId) }, 201);
}

async function listRuns(env, userId) {
  const rows = await env.MONITOR_DB.prepare(`SELECT run_id,objective,status,stage,rounds_completed,max_rounds,model_calls,created_at,updated_at
    FROM foundry_runs WHERE user_id=? ORDER BY updated_at DESC LIMIT ?`).bind(userId, MAX_RUNS).all();
  return json({ runs: rows.results || [] });
}

async function getRun(env, userId, runId) {
  const run = await loadRun(env, userId, runId);
  if (!run) return json({ error: "foundry_run_not_found" }, 404);
  const candidates = await env.MONITOR_DB.prepare(`SELECT candidate_id,parent_id,generation,title,customer,problem,business_model,asymmetry,why_now,revenue_math,risks_json,red_team,score,evidence_confidence,status,created_at,updated_at
    FROM foundry_candidates WHERE run_id=? ORDER BY CASE WHEN score IS NULL THEN 1 ELSE 0 END, score DESC, created_at ASC LIMIT ?`)
    .bind(runId, MAX_CANDIDATES).all();
  const events = await env.MONITOR_DB.prepare(`SELECT event_id,kind,message,metadata_json,created_at FROM foundry_events WHERE run_id=? ORDER BY created_at DESC LIMIT 60`)
    .bind(runId).all();
  return json({
    run,
    candidates: (candidates.results || []).map(publicCandidate),
    events: (events.results || []).map((row) => ({ ...row, metadata: safeJson(row.metadata_json, {}), metadata_json: undefined }))
  });
}

async function stepRun(request, env, userId, runId) {
  const run = await loadRun(env, userId, runId);
  if (!run) return json({ error: "foundry_run_not_found" }, 404);
  if (run.status !== "running") return json({ error: "foundry_run_not_running", run }, 409);
  if (!assistantResponseProviderAvailable(env)) return json({ error: "foundry_model_unavailable" }, 503);

  const limiter = env.ASSISTANT_RATE_LIMITER;
  if (!limiter || typeof limiter.limit !== "function") return json({ error: "foundry_rate_limiter_unavailable" }, 503);
  const limit = await limiter.limit({ key: `foundry:${userId}` });
  if (!limit.success) return json({ error: "foundry_rate_limit_exceeded" }, 429, { "retry-after": "60" });

  try {
    if (run.stage === "discover") await discoveryStep(env, run);
    else if (run.stage === "judge") await judgeStep(env, run);
    else if (run.stage === "challenge") await challengeStep(env, run);
    else return json({ error: "invalid_foundry_stage" }, 500);
  } catch (error) {
    console.warn(JSON.stringify({ event: "foundry_step_failed", run_id: runId, stage: run.stage, error: error?.name || "Error" }));
    await addEvent(env, runId, "step_failed", `Stage ${run.stage} failed without advancing the run.`, { error: error?.name || "Error" });
    return json({ error: "foundry_step_failed", stage: run.stage }, 503);
  }

  const fresh = await loadRun(env, userId, runId);
  return getRun(env, userId, fresh.run_id);
}

async function discoveryStep(env, run) {
  const prompt = [
    `OBJECTIVE: ${run.objective}`,
    "Generate exactly 6 substantially different business candidates from different industries or customer workflows.",
    "Do not assume ProofTTL is part of any solution.",
    "Each candidate must have an identifiable buyer, painful recurring problem, plausible existing spend/loss, specific business model, acquisition path, asymmetry/why-now, and exact $1M annual-revenue math.",
    "Do not invent market statistics. Where evidence is absent, phrase it as a hypothesis to validate.",
    "JSON schema: {\"candidates\":[{\"title\":\"\",\"customer\":\"\",\"problem\":\"\",\"business_model\":\"\",\"asymmetry\":\"\",\"why_now\":\"\",\"revenue_math\":\"\",\"risks\":[\"\"]}]}"
  ].join("\n\n");
  const data = await modelJson(env, prompt, 1500, 0.72);
  const items = Array.isArray(data?.candidates) ? data.candidates.slice(0, 6) : [];
  if (items.length < 3) throw new Error("foundry_invalid_discovery_output");
  const now = new Date().toISOString();
  for (const item of items) await insertCandidate(env, run.run_id, item, 0, null, now);
  await advance(env, run.run_id, "judge", run.rounds_completed, "discovery_complete", `Generated ${items.length} independent candidates.`, { generated: items.length });
}

async function judgeStep(env, run) {
  const candidates = await activeCandidates(env, run.run_id, 14);
  if (candidates.length < 2) throw new Error("foundry_not_enough_candidates");
  const compact = candidates.map((c) => ({
    candidate_id: c.candidate_id, title: c.title, customer: c.customer, problem: c.problem,
    business_model: c.business_model, asymmetry: c.asymmetry, why_now: c.why_now, revenue_math: c.revenue_math,
    previous_score: c.score
  }));
  const prompt = [
    `OBJECTIVE: ${run.objective}`,
    `ROUND: ${run.rounds_completed}`,
    "Act as a hostile investment committee. Evaluate every candidate against pain, existing spend, distribution, margin, founder feasibility, timing/asymmetry, AI commoditization risk, competition, and credible path to $1M annual revenue.",
    "Kill ordinary ideas with no structural advantage. Scores must be comparative, not generous. Keep no more than 5 candidates. Do not claim external research occurred.",
    `CANDIDATES=${JSON.stringify(compact)}`,
    "JSON schema: {\"verdicts\":[{\"candidate_id\":\"\",\"score\":0,\"evidence_confidence\":0,\"status\":\"active|rejected\",\"red_team\":\"strongest reason this fails\"}],\"leader_reason\":\"\"}"
  ].join("\n\n");
  const data = await modelJson(env, prompt, 1800, 0.22);
  const verdicts = Array.isArray(data?.verdicts) ? data.verdicts : [];
  if (verdicts.length < Math.min(2, candidates.length)) throw new Error("foundry_invalid_judge_output");
  const allowedIds = new Set(candidates.map((c) => c.candidate_id));
  let kept = 0;
  const now = new Date().toISOString();
  for (const verdict of verdicts) {
    const id = clean(verdict?.candidate_id, 80);
    if (!allowedIds.has(id)) continue;
    let status = verdict?.status === "active" && kept < 5 ? "active" : "rejected";
    if (status === "active") kept += 1;
    await env.MONITOR_DB.prepare(`UPDATE foundry_candidates SET score=?,evidence_confidence=?,red_team=?,status=?,updated_at=? WHERE run_id=? AND candidate_id=?`)
      .bind(clampNumber(verdict?.score, 0, 100, 0), clampNumber(verdict?.evidence_confidence, 0, 100, 0), clean(verdict?.red_team, 1200), status, now, run.run_id, id).run();
  }
  if (kept < 1) {
    const leader = await env.MONITOR_DB.prepare(`SELECT candidate_id FROM foundry_candidates WHERE run_id=? ORDER BY score DESC LIMIT 1`).bind(run.run_id).first();
    if (leader?.candidate_id) await env.MONITOR_DB.prepare(`UPDATE foundry_candidates SET status='active',updated_at=? WHERE candidate_id=?`).bind(now, leader.candidate_id).run();
    kept = 1;
  }

  if (run.rounds_completed >= run.max_rounds) {
    await env.MONITOR_DB.prepare(`UPDATE foundry_runs SET status='completed',stage='complete',model_calls=model_calls+1,updated_at=? WHERE run_id=?`).bind(now, run.run_id).run();
    await addEvent(env, run.run_id, "run_completed", `Tournament completed after ${run.rounds_completed} challenger rounds.`, { leader_reason: clean(data?.leader_reason, 1200) });
    return;
  }
  await advance(env, run.run_id, "challenge", run.rounds_completed, "judge_complete", `${kept} candidates survived the hostile judge.`, { kept, leader_reason: clean(data?.leader_reason, 1200) });
}

async function challengeStep(env, run) {
  const leaders = await activeCandidates(env, run.run_id, 5);
  if (!leaders.length) throw new Error("foundry_no_leader");
  const compact = leaders.slice(0, 3).map((c) => ({ candidate_id: c.candidate_id, title: c.title, customer: c.customer, problem: c.problem, business_model: c.business_model, asymmetry: c.asymmetry, why_now: c.why_now, revenue_math: c.revenue_math, score: c.score, red_team: c.red_team }));
  const prompt = [
    `OBJECTIVE: ${run.objective}`,
    `CURRENT LEADERS=${JSON.stringify(compact)}`,
    "Your only job is to replace the current leaders, not improve them. Search conceptually in unrelated industries and workflows.",
    "Generate exactly 4 challenger businesses that exploit a stronger asymmetry, cleaner distribution, or better economics than the leaders.",
    "At least 3 challengers must be in industries not represented by the current leaders. Do not make variants of the leaders.",
    "No invented statistics or fake research.",
    "JSON schema: {\"candidates\":[{\"title\":\"\",\"customer\":\"\",\"problem\":\"\",\"business_model\":\"\",\"asymmetry\":\"\",\"why_now\":\"\",\"revenue_math\":\"\",\"risks\":[\"\"]}]}"
  ].join("\n\n");
  const data = await modelJson(env, prompt, 1400, 0.82);
  const items = Array.isArray(data?.candidates) ? data.candidates.slice(0, 4) : [];
  if (items.length < 2) throw new Error("foundry_invalid_challenge_output");
  const now = new Date().toISOString();
  const generation = run.rounds_completed + 1;
  for (const item of items) await insertCandidate(env, run.run_id, item, generation, null, now);
  await advance(env, run.run_id, "judge", generation, "challengers_spawned", `Spawned ${items.length} unrelated challengers for round ${generation}.`, { generated: items.length, generation });
}

async function modelJson(env, userPrompt, maxTokens, temperature) {
  const runtime = assistantModelRuntime(env);
  const completion = await runAssistantResponse(env, {
    messages: [{ role: "system", content: FOUNDRY_SYSTEM }, { role: "user", content: userPrompt }],
    max_tokens: maxTokens,
    temperature
  });
  const text = extractCompletionText(completion);
  if (!text) throw new Error("foundry_empty_model_output");
  const parsed = parseJsonObject(text);
  if (!parsed) throw new Error("foundry_non_json_model_output");
  return { ...parsed, _runtime: { provider: runtime.provider, model: runtime.response_model } };
}

async function insertCandidate(env, runId, item, generation, parentId, now) {
  const title = clean(item?.title, 180);
  if (!title) return;
  const candidateId = `fdc_${crypto.randomUUID().replaceAll("-", "")}`;
  await env.MONITOR_DB.prepare(`INSERT INTO foundry_candidates
    (candidate_id,run_id,parent_id,generation,title,customer,problem,business_model,asymmetry,why_now,revenue_math,risks_json,status,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,'active',?,?)`)
    .bind(candidateId, runId, parentId, generation, title, clean(item?.customer, 600), clean(item?.problem, 1200), clean(item?.business_model, 600), clean(item?.asymmetry, 1000), clean(item?.why_now, 1000), clean(item?.revenue_math, 600), JSON.stringify(cleanArray(item?.risks, 8, 500)), now, now).run();
}

async function activeCandidates(env, runId, limit) {
  const rows = await env.MONITOR_DB.prepare(`SELECT * FROM foundry_candidates WHERE run_id=? AND status='active' ORDER BY CASE WHEN score IS NULL THEN 1 ELSE 0 END, score DESC, created_at ASC LIMIT ?`).bind(runId, limit).all();
  return rows.results || [];
}

async function advance(env, runId, stage, roundsCompleted, eventKind, message, metadata = {}) {
  const now = new Date().toISOString();
  await env.MONITOR_DB.prepare(`UPDATE foundry_runs SET stage=?,rounds_completed=?,model_calls=model_calls+1,updated_at=? WHERE run_id=?`).bind(stage, roundsCompleted, now, runId).run();
  await addEvent(env, runId, eventKind, message, metadata);
}

async function addEvent(env, runId, kind, message, metadata = {}) {
  await env.MONITOR_DB.prepare(`INSERT INTO foundry_events (event_id,run_id,kind,message,metadata_json,created_at) VALUES (?,?,?,?,?,?)`)
    .bind(`fde_${crypto.randomUUID().replaceAll("-", "")}`, runId, kind, message, JSON.stringify(metadata), new Date().toISOString()).run();
}

async function loadRun(env, userId, runId) {
  return env.MONITOR_DB.prepare(`SELECT run_id,objective,status,stage,rounds_completed,max_rounds,model_calls,created_at,updated_at FROM foundry_runs WHERE user_id=? AND run_id=?`).bind(userId, runId).first();
}

function publicCandidate(row) {
  return { ...row, risks: safeJson(row.risks_json, []), risks_json: undefined };
}

function extractCompletionText(value) {
  if (typeof value === "string") return value.trim();
  if (typeof value?.response === "string") return value.response.trim();
  if (typeof value?.result?.response === "string") return value.result.response.trim();
  if (typeof value?.choices?.[0]?.message?.content === "string") return value.choices[0].message.content.trim();
  return "";
}

function parseJsonObject(text) {
  const raw = String(text || "").trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
  try { return JSON.parse(raw); } catch {}
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try { return JSON.parse(raw.slice(start, end + 1)); } catch { return null; }
}

function clean(value, max) { return typeof value === "string" ? value.trim().slice(0, max) : ""; }
function cleanArray(value, maxItems, maxChars) { return Array.isArray(value) ? value.map((x) => clean(x, maxChars)).filter(Boolean).slice(0, maxItems) : []; }
function safeJson(value, fallback) { try { return JSON.parse(value); } catch { return fallback; } }
function clampInt(value, min, max, fallback) { const n = Number(value); return Number.isInteger(n) ? Math.min(max, Math.max(min, n)) : fallback; }
function clampNumber(value, min, max, fallback) { const n = Number(value); return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback; }
function json(body, status = 200, extra = {}) { return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...extra } }); }
