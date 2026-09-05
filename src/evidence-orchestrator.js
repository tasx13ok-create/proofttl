import { createEvidenceExecutor } from "./evidence-executor.js";
import { materializeEvidenceExecutionBudget } from "./evidence-runtime-budget.js";
import { validatePublicSourceUrl } from "./security.js";
import { deriveExecutedVerificationOutcome } from "./verification-context.js";
import { buildEvidencePlan, triageClaimContract } from "./verification-plan.js";

const VERSION = "proofttl-evidence-orchestrator-v1";

export async function executeEvidencePlan({ claim_contract, triage = null, evidence_plan = null, pricing = {}, providers = {}, hard_cost_ceiling_usd = null, emit = null, now = Date.now, validate_source_url = validatePublicSourceUrl } = {}) {
  if (!claim_contract || typeof claim_contract !== "object") throw new Error("evidence_orchestrator_claim_contract_required");
  if (typeof validate_source_url !== "function") throw new Error("evidence_orchestrator_source_url_validator_required");
  const resolvedTriage = triage || triageClaimContract(claim_contract);
  const resolvedPlan = evidence_plan || buildEvidencePlan(claim_contract, resolvedTriage);
  if (resolvedPlan.status !== "PLANNED") return finalize(claim_contract, resolvedTriage, resolvedPlan, [], [], null, null);

  const runtimeBudget = materializeEvidenceExecutionBudget(resolvedPlan, pricing, { hard_cost_ceiling_usd });
  const executor = createEvidenceExecutor({ execution_budget: runtimeBudget.execution_budget, providers: wrapProviders(providers, validate_source_url), emit, now });
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
    if (result.status === "COMPLETED") fetched.push({
      ...result.value,
      discovery_source_url: candidate.source_url,
      discovery_provenance: candidate.discovery_provenance
    });
  }

  for (let i = 0; i < Math.min(fetched.length, runtimeBudget.execution_budget.max_semantic_evaluations); i += 1) {
    const source = fetched[i];
    const result = await run(executor, actionResults, "SEMANTIC_EVALUATION", `semantic:${i}:${source.source_url}`, runtimeBudget.reserve_cost_usd.SEMANTIC_EVALUATION, { claim_contract, source });
    if (result.status === "COMPLETED") evidenceItems.push({
      ...result.value,
      provenance: {
        ...result.value.provenance,
        discovery_source_url: source.discovery_source_url || null,
        discovery_provenance: source.discovery_provenance || null
      }
    });
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

function wrapProviders(providers, validateSourceUrl) {
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
      await validateSourceBindings(kind, result.value, context?.request, validateSourceUrl);
      return result;
    };
  }
  return wrapped;
}

function validateValue(kind, value) {
  if (kind === "CANDIDATE_QUERY" || kind === "CONTRADICTION_QUERY") {
    if (!Array.isArray(value) || value.some((item) => !item || typeof item !== "object" || Array.isArray(item) || !validUrl(item.source_url))) throw contractError(kind);
    return;
  }
  if (kind === "SOURCE_FETCH") {
    if (!value || typeof value !== "object" || Array.isArray(value) || !validUrl(value.source_url)) throw contractError(kind);
    return;
  }
  const valid = value && typeof value === "object" && !Array.isArray(value) && validUrl(value.source_url) && typeof value.entailment === "string" && Boolean(String(value.observed_at || "").trim()) && value.provenance && typeof value.provenance === "object" && !Array.isArray(value.provenance);
  if (!valid) throw contractError(kind);
}

async function validateSourceBindings(kind, value, request, validateSourceUrl) {
  const urls = kind === "CANDIDATE_QUERY" || kind === "CONTRADICTION_QUERY"
    ? value.map((item) => item.source_url)
    : [value.source_url];

  for (const sourceUrl of urls) {
    const safety = await validateSourceUrl(sourceUrl);
    if (!safety || safety.ok !== true) {
      throw contractError(kind, `unsafe_source_url:${safety?.reason || "rejected"}`);
    }
  }

  if (kind === "SOURCE_FETCH") {
    const expected = normalizeUrl(request?.candidate?.source_url);
    const actual = normalizeUrl(value.source_url);
    const requested = normalizeUrl(value.requested_source_url);
    if (!expected || (actual !== expected && requested !== expected)) {
      throw contractError(kind, "source_fetch_not_bound_to_candidate");
    }
  }

  if (kind === "SEMANTIC_EVALUATION") {
    const expected = normalizeUrl(request?.source?.source_url);
    const actual = normalizeUrl(value.source_url);
    if (!expected || actual !== expected) {
      throw contractError(kind, "semantic_result_not_bound_to_source");
    }
  }
}

function contractError(kind, reason = null) {
  const error = new Error(`evidence_provider_contract_invalid:${kind}${reason ? `:${reason}` : ""}`);
  error.code = `EVIDENCE_PROVIDER_CONTRACT_INVALID_${kind}`;
  return error;
}

function tagCandidates(items, provenance) { return items.map((item) => ({ ...item, discovery_provenance: provenance })); }
function dedupeCandidates(items) {
  const seen = new Set();
  const unique = [];
  for (const item of items) {
    const key = normalizeUrl(item.source_url);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    unique.push({ ...item, source_url: key });
  }
  return unique;
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
