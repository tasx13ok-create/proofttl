import { getOptionalProofTTLSession } from "./auth.js";
import { assistantModelRuntime, assistantResponseProviderAvailable, runAssistantResponse } from "./assistant-model-router.js";
import { collectFoundryEvidence, normalizeFoundrySearchQueries } from "./foundry-research.js";

const MAX_OBJECTIVE_CHARS = 2000;
const MAX_RUNS = 20;
const MAX_CANDIDATES = 80;
const MAX_EVIDENCE = 80;
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
  "When an EVIDENCE ledger is supplied, only cite evidence IDs present in that ledger. A headline, discussion, or excerpt is a market signal, not automatic proof of demand, market size, pricing, or causation.",
  "Do not claim customer interviews, simulations, market statistics, source contents, or evidence that were not actually supplied. Mark unsupported market facts as hypotheses.",
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
    if (request.method === "POST") return stepRun(env, userId, stepMatch[1]);
    return json({ error: "method_not_allowed" }, 405, { allow: "POST, OPTIONS" });
  }

  return json({ error: "not_found" }, 404);
}

export async function runFoundryScheduled(env) {
  if (!env?.MONITOR_DB || !assistantResponseProviderAvailable(env)) return { advanced: false, reason: "unavailable" };
  const run = await env.MONITOR_DB.prepare(`SELECT run_id,user_id,objective,status,stage,rounds_completed,max_rounds,model_calls,created_at,updated_at
    FROM foundry_runs WHERE status='running' ORDER BY updated_at ASC LIMIT 1`).first();
  if (!run) return { advanced: false, reason: "no_running_runs" };
  try {
    await executeStage(env, run);
    return { advanced: true, run_id: run.run_id, stage: run.stage };
  } catch (error) {
    console.warn(JSON.stringify({ event: "foundry_scheduled_step_failed", run_id: run.run_id, stage: run.stage, error: error?.name || "Error" }));
    await addEvent(env, run.run_id, "scheduled_step_failed", `Scheduled stage ${run.stage} failed without advancing the run.`, { error: error?.name || "Error" });
    return { advanced: false, reason: "step_failed", run_id: run.run_id };
  }
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
    VALUES (?,?,?,'running','research',0,?,0,?,?)`)
    .bind(runId, userId, objective, maxRounds, now, now).run();
  await addEvent(env, runId, "run_started", "Foundry run created. Live signal research is queued before idea generation.", { max_rounds: maxRounds });
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
  const candidatesResult = await env.MONITOR_DB.prepare(`SELECT candidate_id,parent_id,generation,title,customer,problem,business_model,asymmetry,why_now,revenue_math,risks_json,red_team,score,evidence_confidence,status,created_at,updated_at
    FROM foundry_candidates WHERE run_id=? ORDER BY CASE WHEN score IS NULL THEN 1 ELSE 0 END, score DESC, created_at ASC LIMIT ?`)
    .bind(runId, MAX_CANDIDATES).all();
  const events = await env.MONITOR_DB.prepare(`SELECT event_id,kind,message,metadata_json,created_at FROM foundry_events WHERE run_id=? ORDER BY created_at DESC LIMIT 60`)
    .bind(runId).all();
  const evidence = await loadEvidence(env, runId, MAX_EVIDENCE);
  const links = await loadCandidateEvidenceMap(env, runId);
  return json({
    run,
    candidates: (candidatesResult.results || []).map((row) => publicCandidate(row, links)),
    evidence,
    events: (events.results || []).map((row) => ({ ...row, metadata: safeJson(row.metadata_json, {}), metadata_json: undefined }))
  });
}

async function stepRun(env, userId, runId) {
  const run = await loadRun(env, userId, runId);
  if (!run) return json({ error: "foundry_run_not_found" }, 404);
  if (run.status !== "running") return json({ error: "foundry_run_not_running", run }, 409);
  if (!assistantResponseProviderAvailable(env)) return json({ error: "foundry_model_unavailable" }, 503);

  const limiter = env.ASSISTANT_RATE_LIMITER;
  if (!limiter || typeof limiter.limit !== "function") return json({ error: "foundry_rate_limiter_unavailable" }, 503);
  const limit = await limiter.limit({ key: `foundry:${userId}` });
  if (!limit.success) return json({ error: "foundry_rate_limit_exceeded" }, 429, { "retry-after": "60" });

  try {
    await executeStage(env, run);
  } catch (error) {
    console.warn(JSON.stringify({ event: "foundry_step_failed", run_id: runId, stage: run.stage, error: error?.name || "Error" }));
    await addEvent(env, runId, "step_failed", `Stage ${run.stage} failed without advancing the run.`, { error: error?.name || "Error" });
    return json({ error: "foundry_step_failed", stage: run.stage }, 503);
  }

  return getRun(env, userId, runId);
}

async function executeStage(env, run) {
  if (run.stage === "research") return researchStep(env, run);
  if (run.stage === "discover") return discoveryStep(env, run);
  if (run.stage === "judge") return judgeStep(env, run);
  if (run.stage === "challenge") return challengeStep(env, run);
  throw new Error("invalid_foundry_stage");
}

async function researchStep(env, run) {
  const prompt = [
    `OBJECTIVE: ${run.objective}`,
    "Before generating businesses, plan current-market signal searches.",
    "Return exactly 4 concise search queries. Each query must target a substantially different industry or workflow and should be likely to surface expensive recurring pain, labor bottlenecks, regulation/compliance changes, software dissatisfaction, cost increases, or newly automatable work.",
    "Do not include ProofTTL, startup ideas, or proposed products. Search for problems and structural changes only.",
    "JSON schema: {\"queries\":[\"\",\"\",\"\",\"\"]}"
  ].join("\n\n");
  const data = await modelJson(env, prompt, 500, 0.64);
  const queries = normalizeFoundrySearchQueries(data?.queries);
  if (queries.length < 2) throw new Error("foundry_invalid_research_queries");

  const collected = await collectFoundryEvidence(queries);
  const now = new Date().toISOString();
  for (const item of collected.evidence) await insertEvidence(env, run.run_id, item, now);
  await advance(
    env,
    run.run_id,
    "discover",
    run.rounds_completed,
    "research_complete",
    `Collected ${collected.stats.evidence_items} live signals from ${collected.stats.successful_sources}/${collected.stats.requested_sources} fixed public-source searches.`,
    { queries, ...collected.stats, failures: collected.failures.slice(0, 8) }
  );
}

async function discoveryStep(env, run) {
  const evidence = await loadEvidence(env, run.run_id, 40);
  const prompt = [
    `OBJECTIVE: ${run.objective}`,
    `EVIDENCE=${JSON.stringify(evidence)}`,
    "Generate exactly 6 substantially different business candidates from different industries or customer workflows.",
    "Use the evidence ledger as market signals. Do not assume a headline or discussion proves willingness to pay. Every candidate should cite only the evidence IDs that materially informed it; an empty evidence_ids list is allowed when the candidate is explicitly a hypothesis.",
    "Do not assume ProofTTL is part of any solution.",
    "Each candidate must have an identifiable buyer, painful recurring problem, plausible existing spend/loss, specific business model, acquisition path, asymmetry/why-now, and exact $1M annual-revenue math.",
    "Do not invent market statistics. Where evidence is absent, phrase the claim as a hypothesis to validate.",
    "JSON schema: {\"candidates\":[{\"title\":\"\",\"customer\":\"\",\"problem\":\"\",\"business_model\":\"\",\"asymmetry\":\"\",\"why_now\":\"\",\"revenue_math\":\"\",\"risks\":[\"\"],\"evidence_ids\":[\"fve_...\"]}]}"
  ].join("\n\n");
  const data = await modelJson(env, prompt, 1700, 0.72);
  const items = Array.isArray(data?.candidates) ? data.candidates.slice(0, 6) : [];
  if (items.length < 3) throw new Error("foundry_invalid_discovery_output");
  const now = new Date().toISOString();
  for (const item of items) await insertCandidate(env, run.run_id, item, 0, null, now);
  await advance(env, run.run_id, "judge", run.rounds_completed, "discovery_complete", `Generated ${items.length} evidence-aware candidates.`, { generated: items.length, evidence_available: evidence.length });
}

async function judgeStep(env, run) {
  const candidates = await activeCandidates(env, run.run_id, 14);
  if (candidates.length < 2) throw new Error("foundry_not_enough_candidates");
  const evidence = await loadEvidence(env, run.run_id, 40);
  const linkMap = await loadCandidateEvidenceMap(env, run.run_id);
  const compact = candidates.map((c) => ({
    candidate_id: c.candidate_id, title: c.title, customer: c.customer, problem: c.problem,
    business_model: c.business_model, asymmetry: c.asymmetry, why_now: c.why_now, revenue_math: c.revenue_math,
    evidence_ids: linkMap.get(c.candidate_id) || [], previous_score: c.score
  }));
  const prompt = [
    `OBJECTIVE: ${run.objective}`,
    `ROUND: ${run.rounds_completed}`,
    `EVIDENCE=${JSON.stringify(evidence)}`,
    "Act as a hostile investment committee. Evaluate every candidate against pain, existing spend, distribution, margin, founder feasibility, timing/asymmetry, AI commoditization risk, competition, evidence strength, and credible path to $1M annual revenue.",
    "Kill ordinary ideas with no structural advantage. Scores must be comparative, not generous. Keep no more than 5 candidates.",
    "Evidence confidence must reflect what the supplied ledger actually demonstrates. A candidate with no linked evidence should normally stay below 35 confidence; a headline alone is weak evidence; do not infer facts from a source URL you have not read.",
    `CANDIDATES=${JSON.stringify(compact)}`,
    "JSON schema: {\"verdicts\":[{\"candidate_id\":\"\",\"score\":0,\"evidence_confidence\":0,\"status\":\"active|rejected\",\"red_team\":\"strongest reason this fails\"}],\"leader_reason\":\"\"}"
  ].join("\n\n");
  const data = await modelJson(env, prompt, 1900, 0.22);
  const verdicts = Array.isArray(data?.verdicts) ? data.verdicts : [];
  if (verdicts.length < Math.min(2, candidates.length)) throw new Error("foundry_invalid_judge_output");
  const allowedIds = new Set(candidates.map((c) => c.candidate_id));
  let kept = 0;
  const now = new Date().toISOString();
  for (const verdict of verdicts) {
    const id = clean(verdict?.candidate_id, 80);
    if (!allowedIds.has(id)) continue;
    const status = verdict?.status === "active" && kept < 5 ? "active" : "rejected";
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
  const evidence = await loadEvidence(env, run.run_id, 40);
  const linkMap = await loadCandidateEvidenceMap(env, run.run_id);
  const compact = leaders.slice(0, 3).map((c) => ({
    candidate_id: c.candidate_id, title: c.title, customer: c.customer, problem: c.problem,
    business_model: c.business_model, asymmetry: c.asymmetry, why_now: c.why_now, revenue_math: c.revenue_math,
    score: c.score, red_team: c.red_team, evidence_ids: linkMap.get(c.candidate_id) || []
  }));
  const prompt = [
    `OBJECTIVE: ${run.objective}`,
    `CURRENT LEADERS=${JSON.stringify(compact)}`,
    `EVIDENCE=${JSON.stringify(evidence)}`,
    "Your only job is to replace the current leaders, not improve them. Search conceptually in unrelated industries and workflows.",
    "Generate exactly 4 challenger businesses that exploit a stronger asymmetry, cleaner distribution, or better economics than the leaders.",
    "At least 3 challengers must be in industries not represented by the current leaders. Do not make variants of the leaders.",
    "Use evidence IDs only when the supplied signal genuinely informs the challenger. No invented statistics or fake research.",
    "JSON schema: {\"candidates\":[{\"title\":\"\",\"customer\":\"\",\"problem\":\"\",\"business_model\":\"\",\"asymmetry\":\"\",\"why_now\":\"\",\"revenue_math\":\"\",\"risks\":[\"\"],\"evidence_ids\":[\"fve_...\"]}]}"
  ].join("\n\n");
  const data = await modelJson(env, prompt, 1550, 0.82);
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
  for (const evidenceId of cleanEvidenceIds(item?.evidence_ids)) {
    await env.MONITOR_DB.prepare(`INSERT OR IGNORE INTO foundry_candidate_evidence (candidate_id,evidence_id)
      SELECT ?, evidence_id FROM foundry_evidence WHERE run_id=? AND evidence_id=?`).bind(candidateId, runId, evidenceId).run();
  }
}

async function insertEvidence(env, runId, item, now) {
  const title = clean(item?.title, 260);
  const url = clean(item?.url, 1600);
  const queryText = clean(item?.query_text, 120);
  const sourceType = clean(item?.source_type, 60);
  if (!title || !url || !queryText || !sourceType) return;
  const evidenceId = `fve_${crypto.randomUUID().replaceAll("-", "")}`;
  await env.MONITOR_DB.prepare(`INSERT INTO foundry_evidence
    (evidence_id,run_id,source_type,query_text,title,url,excerpt,published_at,source_domain,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?)`)
    .bind(evidenceId, runId, sourceType, queryText, title, url, cleanOptional(item?.excerpt, 900), cleanOptional(item?.published_at, 80), cleanOptional(item?.source_domain, 200), now).run();
}

async function activeCandidates(env, runId, limit) {
  const rows = await env.MONITOR_DB.prepare(`SELECT * FROM foundry_candidates WHERE run_id=? AND status='active' ORDER BY CASE WHEN score IS NULL THEN 1 ELSE 0 END, score DESC, created_at ASC LIMIT ?`).bind(runId, limit).all();
  return rows.results || [];
}

async function loadEvidence(env, runId, limit) {
  const rows = await env.MONITOR_DB.prepare(`SELECT evidence_id,source_type,query_text,title,url,excerpt,published_at,source_domain,created_at
    FROM foundry_evidence WHERE run_id=? ORDER BY created_at ASC LIMIT ?`).bind(runId, limit).all();
  return rows.results || [];
}

async function loadCandidateEvidenceMap(env, runId) {
  const rows = await env.MONITOR_DB.prepare(`SELECT ce.candidate_id,ce.evidence_id
    FROM foundry_candidate_evidence ce JOIN foundry_candidates c ON c.candidate_id=ce.candidate_id
    WHERE c.run_id=? ORDER BY ce.candidate_id,ce.evidence_id`).bind(runId).all();
  const map = new Map();
  for (const row of rows.results || []) {
    const list = map.get(row.candidate_id) || [];
    list.push(row.evidence_id);
    map.set(row.candidate_id, list);
  }
  return map;
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

function publicCandidate(row, links = new Map()) {
  return { ...row, risks: safeJson(row.risks_json, []), risks_json: undefined, evidence_ids: links.get(row.candidate_id) || [] };
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
function cleanOptional(value, max) { const out = clean(value, max); return out || null; }
function cleanArray(value, maxItems, maxChars) { return Array.isArray(value) ? value.map((x) => clean(x, maxChars)).filter(Boolean).slice(0, maxItems) : []; }
function cleanEvidenceIds(value) { return Array.isArray(value) ? [...new Set(value.map((x) => clean(x, 80).toLowerCase()).filter((x) => /^fve_[a-f0-9]{32}$/.test(x)))].slice(0, 12) : []; }
function safeJson(value, fallback) { try { return JSON.parse(value); } catch { return fallback; } }
function clampInt(value, min, max, fallback) { const n = Number(value); return Number.isInteger(n) ? Math.min(max, Math.max(min, n)) : fallback; }
function clampNumber(value, min, max, fallback) { const n = Number(value); return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback; }
function json(body, status = 200, extra = {}) { return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...extra } }); }
