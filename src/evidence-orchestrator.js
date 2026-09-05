import { createEvidenceExecutor } from "./evidence-executor.js";
import { materializeEvidenceExecutionBudget } from "./evidence-runtime-budget.js";
import { deriveExecutedVerificationOutcome } from "./verification-context.js";
import { buildEvidencePlan, triageClaimContract } from "./verification-plan.js";

const VERSION = "proofttl-evidence-orchestrator-v1";

export async function executeEvidencePlan({ claim_contract, triage = null, evidence_plan = null, pricing = {}, providers = {}, hard_cost_ceiling_usd = null, emit = null, now = Date.now } = {}) {
  if (!claim_contract || typeof claim_contract !== "object") throw new Error("evidence_orchestrator_claim_contract_required");
  const resolvedTriage = triage || triageClaimContract(claim_contract);
  const resolvedPlan = evidence_plan || buildEvidencePlan(claim_contract, resolvedTriage);
  if (resolvedPlan.status !== "PLANNED") return finalize(claim_contract, resolvedTriage, resolvedPlan, [], [], null, null);

  const runtimeBudget = materializeEvidenceExecutionBudget(resolvedPlan, pricing, { hard_cost_ceiling_usd });
  const executor = createEvidenceExecutor({ execution_budget: runtimeBudget.execution_budget, providers: wrapProviders(providers), emit, now });
  const actionResults = [];
  const candidates = [];
  const fetched = [];
  const evidenceItems = [];

  const primaryIntents = resolvedPlan.query_intents.filter((intent) => intent?.purpose !== "ADVERSARIAL_CONTRADICTION").slice(0, runtimeBudget.execution_budget.max_candidate_queries);
  for (let i = 0; i < primaryIntents.length; i += 1) {
    const intent = primaryIntents[i];
    const result = await run(executor, actionResults, "CANDIDATE_QUERY", `candidate:${i}`, runtimeBudget.reserve_cost_usd.CANDIDATE_QUERY, { claim_contract, intent });
    if (result.status === "COMPLETED") candidates.push(...tagCandidates(result.value, "PRIMARY_DISCOVERY"));
  }

  if (resolvedPlan.contradiction_pass_required === true) {
    const intent = resolvedPlan.query_intents.find((item) => item?.purpose === "ADVERSARIAL_CONTRADICTION");
    const result = await run(executor, actionResults, "CONTRADICTION_QUERY", "contradiction:0", runtimeBudget.reserve_cost_usd.CONTRADICTION_QUERY, { claim_contract, intent });
    if (result.status === "COMPLETED") candidates.push(...tagCandidates(result.value, "ADVERSARIAL_CONTRADICTION"));
  }

  const unique = dedupeCandidates(candidates).slice(0, runtimeBudget.execution_budget.max_source_fetches);
  for (let i = 0; i < unique.length; i += 1) {
    const candidate = unique[i];
    const result = await run(executor, actionResults, "SOURCE_FETCH", `fetch:${i}:${candidate.source_url}`, runtimeBudget.reserve_cost_usd.SOURCE_FETCH, { claim_contract, candidate });
    if (result.status === "COMPLETED") fetched.push({ ...result.value, discovery_provenance: candidate.discovery_provenance });
  }

  for (let i = 0; i < Math.min(fetched.length, runtimeBudget.execution_budget.max_semantic_evaluations); i += 1) {
    const source = fetched[i];
    const result = await run(executor, actionResults, "SEMANTIC_EVALUATION", `semantic:${i}:${source.source_url}`, runtimeBudget.reserve_cost_usd.SEMANTIC_EVALUATION, { claim_contract, source });
    if (result.status === "COMPLETED") evidenceItems.push({ ...result.value, provenance: { ...result.value.provenance, discovery_provenance: source.discovery_provenance || null } });
  }

  return finalize(claim_contract, resolvedTriage, resolvedPlan, evidenceItems, actionResults, runtimeBudget, executor.snapshot());
}

async function run(executor, results, kind, idempotency_key, reserve_cost_usd, request) {
  const result = await executor.run({ kind, idempotency_key, reserve_cost_usd, request: Object.freeze(request) });
  results.push(result);
  return result;
}

function finalize(claimContract, triage, plan, evidenceItems, actionResults, runtimeBudget, executorState) {
  const outcome = deriveExecutedVerificationOutcome({ claim_contract: claimContract, evidence_items: evidenceItems, action_results: actionResults, triage, evidence_plan: plan });
  return Object.freeze({ version: VERSION, outcome, evidence_items: Object.freeze(evidenceItems), action_results: Object.freeze(actionResults), runtime_budget: runtimeBudget, executor_state: executorState });
}

function wrapProviders(providers) {
  if (!providers || typeof providers !== "object" || Array.isArray(providers)) throw new Error("evidence_orchestrator_providers_required");
  const wrapped = {};
  for (const kind of ["CANDIDATE_QUERY", "SOURCE_FETCH", "SEMANTIC_EVALUATION", "CONTRADICTION_QUERY"]) {
    const provider = providers[kind];
    if (provider == null) continue;
    if (typeof provider !== "function") throw new Error(`evidence_provider_invalid:${kind}`);
    wrapped[kind] = async (context) => {
      const result = await provider(context);
      if (!result || typeof result !== "object" || Array.isArray(result) || !Object.prototype.hasOwnProperty.call(result, "value")) throw contractError(kind);
      validateValue(kind, result.value);
      return result;
    };
  }
  return wrapped;
}

function validateValue(kind, value) {
  if (kind === "CANDIDATE_QUERY" || kind === "CONTRADICTION_QUERY") {
    if (!Array.isArray(value) || value.some((item) => !validUrl(item?.source_url))) throw contractError(kind);
    return;
  }
  if (kind === "SOURCE_FETCH") {
    if (!value || typeof value !== "object" || Array.isArray(value) || !validUrl(value.source_url)) throw contractError(kind);
    return;
  }
  const valid = value && typeof value === "object" && !Array.isArray(value) && validUrl(value.source_url) && typeof value.entailment === "string" && Boolean(String(value.observed_at || "").trim()) && value.provenance && typeof value.provenance === "object" && !Array.isArray(value.provenance);
  if (!valid) throw contractError(kind);
}

function contractError(kind) {
  const error = new Error(`evidence_provider_contract_invalid:${kind}`);
  error.code = `EVIDENCE_PROVIDER_CONTRACT_INVALID_${kind}`;
  return error;
}

function tagCandidates(items, provenance) { return items.map((item) => ({ ...item, discovery_provenance: provenance })); }
function dedupeCandidates(items) {
  const seen = new Set();
  return items.filter((item) => {
    const key = normalizeUrl(item.source_url);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    item.source_url = key;
    return true;
  });
}
function validUrl(value) { return normalizeUrl(value) !== null; }
function normalizeUrl(value) {
  try {
    const url = new URL(String(value));
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    url.hash = "";
    return url.toString();
  } catch { return null; }
}
