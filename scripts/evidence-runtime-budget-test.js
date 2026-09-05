import assert from "node:assert/strict";
import { materializeEvidenceExecutionBudget } from "../src/evidence-runtime-budget.js";

const plan = {
  version: "proofttl-evidence-plan-v1",
  status: "PLANNED",
  execution_budget: {
    max_candidate_queries: 2,
    max_source_fetches: 3,
    max_semantic_evaluations: 3,
    max_contradiction_queries: 1,
    latency_budget_ms: 10_000,
    hard_cost_ceiling_usd: null,
    hard_cost_ceiling_state: "REQUIRES_RUNTIME_PRICING_ENFORCEMENT"
  }
};

const pricing = {
  candidate_query: 0.01,
  source_fetch: 0.02,
  semantic_evaluation: 0.03,
  contradiction_query: 0.04
};

{
  const runtime = materializeEvidenceExecutionBudget(plan, pricing);
  assert.equal(runtime.execution_budget.hard_cost_ceiling_usd, 0.21);
  assert.equal(runtime.worst_case_cost_usd, 0.21);
  assert.equal(runtime.pricing_state, "RUNTIME_PRICING_MATERIALIZED");
  assert.deepEqual(runtime.reserve_cost_usd, {
    CANDIDATE_QUERY: 0.01,
    SOURCE_FETCH: 0.02,
    SEMANTIC_EVALUATION: 0.03,
    CONTRADICTION_QUERY: 0.04
  });
  assert.equal(Object.isFrozen(runtime.execution_budget), true);
  assert.equal(Object.isFrozen(runtime.reserve_cost_usd), true);
}

{
  const runtime = materializeEvidenceExecutionBudget(plan, pricing, { hard_cost_ceiling_usd: 0.1 });
  assert.equal(runtime.execution_budget.hard_cost_ceiling_usd, 0.1);
  assert.equal(runtime.worst_case_cost_usd, 0.21);
  assert.equal(runtime.configured_cost_ceiling_usd, 0.1);
}

assert.throws(
  () => materializeEvidenceExecutionBudget({ ...plan, status: "NOT_SCHEDULED" }, pricing),
  /evidence_runtime_budget_plan_not_executable/
);
assert.throws(
  () => materializeEvidenceExecutionBudget(plan, { ...pricing, source_fetch: undefined }),
  /evidence_runtime_budget_invalid_pricing_source_fetch/
);
assert.throws(
  () => materializeEvidenceExecutionBudget(plan, { ...pricing, semantic_evaluation: -1 }),
  /evidence_runtime_budget_invalid_pricing_semantic_evaluation/
);
assert.throws(
  () => materializeEvidenceExecutionBudget(plan, pricing, { hard_cost_ceiling_usd: Number.NaN }),
  /evidence_runtime_budget_invalid_hard_cost_ceiling_usd/
);

console.log("Evidence runtime budget tests passed.");
