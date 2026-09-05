const PLAN_VERSION = "proofttl-evidence-plan-v1";
const ACTION_PRICING_FIELD = Object.freeze({
  CANDIDATE_QUERY: ["max_candidate_queries", "candidate_query"],
  SOURCE_FETCH: ["max_source_fetches", "source_fetch"],
  SEMANTIC_EVALUATION: ["max_semantic_evaluations", "semantic_evaluation"],
  CONTRADICTION_QUERY: ["max_contradiction_queries", "contradiction_query"]
});

export function materializeEvidenceExecutionBudget(evidencePlan, pricing = {}, options = {}) {
  validatePlan(evidencePlan);
  if (evidencePlan.status !== "PLANNED") {
    throw new Error("evidence_runtime_budget_plan_not_executable");
  }

  const planned = evidencePlan.execution_budget;
  if (!planned || typeof planned !== "object" || Array.isArray(planned)) {
    throw new Error("evidence_runtime_budget_plan_budget_required");
  }

  const reserveCosts = {};
  let worstCaseCostUsd = 0;

  for (const [kind, [limitField, pricingField]] of Object.entries(ACTION_PRICING_FIELD)) {
    const limit = Number(planned[limitField]);
    if (!Number.isInteger(limit) || limit < 0) {
      throw new Error(`evidence_runtime_budget_invalid_${limitField}`);
    }

    const reserveCost = limit === 0
      ? 0
      : finiteUsd(pricing?.[pricingField], `pricing_${pricingField}`);
    reserveCosts[kind] = reserveCost;
    worstCaseCostUsd = roundUsd(worstCaseCostUsd + limit * reserveCost);
  }

  const configuredCap = options.hard_cost_ceiling_usd == null
    ? null
    : finiteUsd(options.hard_cost_ceiling_usd, "hard_cost_ceiling_usd");
  const hardCostCeilingUsd = configuredCap == null
    ? worstCaseCostUsd
    : Math.min(configuredCap, worstCaseCostUsd);

  const latencyBudgetMs = Number(planned.latency_budget_ms);
  if (!Number.isInteger(latencyBudgetMs) || latencyBudgetMs <= 0) {
    throw new Error("evidence_runtime_budget_latency_budget_ms_required");
  }

  return Object.freeze({
    execution_budget: Object.freeze({
      max_candidate_queries: Number(planned.max_candidate_queries),
      max_source_fetches: Number(planned.max_source_fetches),
      max_semantic_evaluations: Number(planned.max_semantic_evaluations),
      max_contradiction_queries: Number(planned.max_contradiction_queries),
      latency_budget_ms: latencyBudgetMs,
      hard_cost_ceiling_usd: hardCostCeilingUsd
    }),
    reserve_cost_usd: Object.freeze(reserveCosts),
    pricing_state: "RUNTIME_PRICING_MATERIALIZED",
    worst_case_cost_usd: worstCaseCostUsd,
    configured_cost_ceiling_usd: configuredCap
  });
}

function validatePlan(plan) {
  if (!plan || typeof plan !== "object" || Array.isArray(plan) || plan.version !== PLAN_VERSION) {
    throw new Error("evidence_runtime_budget_plan_required");
  }
}

function finiteUsd(value, field) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) {
    throw new Error(`evidence_runtime_budget_invalid_${field}`);
  }
  return roundUsd(number);
}

function roundUsd(value) {
  return Math.round(value * 1e12) / 1e12;
}
