import assert from "node:assert/strict";
import {
  closeEvidenceBudget,
  createEvidenceBudgetState,
  evidenceBudgetRemaining,
  reserveEvidenceAction,
  settleEvidenceAction
} from "../src/evidence-budget.js";

const budget = {
  max_candidate_queries: 2,
  max_source_fetches: 3,
  max_semantic_evaluations: 2,
  max_contradiction_queries: 1,
  latency_budget_ms: 10000,
  hard_cost_ceiling_usd: 0.01
};

let checks = 0;
function check(name, fn) {
  fn();
  checks += 1;
  console.log(`ok ${checks} - ${name}`);
}

check("budget state starts with full bounded capacity", () => {
  const state = createEvidenceBudgetState(budget);
  assert.equal(evidenceBudgetRemaining(state).candidate_queries, 2);
  assert.equal(evidenceBudgetRemaining(state).cost_usd, 0.01);
});

check("reservation consumes both call and spend capacity", () => {
  let state = createEvidenceBudgetState(budget);
  state = reserveEvidenceAction(state, { kind: "CANDIDATE_QUERY", reserve_cost_usd: 0.002 });
  assert.equal(state.used.max_candidate_queries, 1);
  assert.equal(state.reserved_cost_usd, 0.002);
  assert.equal(evidenceBudgetRemaining(state).cost_usd, 0.008);
});

check("settlement releases unused reservation without hiding actual spend", () => {
  let state = createEvidenceBudgetState(budget);
  state = reserveEvidenceAction(state, { kind: "SEMANTIC_EVALUATION", reserve_cost_usd: 0.004 });
  state = settleEvidenceAction(state, { reserved_cost_usd: 0.004, actual_cost_usd: 0.0015 });
  assert.equal(state.reserved_cost_usd, 0);
  assert.equal(state.actual_cost_usd, 0.0015);
  assert.equal(evidenceBudgetRemaining(state).cost_usd, 0.0085);
});

check("call ceilings fail closed before work starts", () => {
  let state = createEvidenceBudgetState({ ...budget, max_source_fetches: 1 });
  state = reserveEvidenceAction(state, { kind: "SOURCE_FETCH", reserve_cost_usd: 0 });
  assert.throws(
    () => reserveEvidenceAction(state, { kind: "SOURCE_FETCH", reserve_cost_usd: 0 }),
    /max_source_fetches_exceeded/
  );
});

check("hard dollar ceiling fails closed before work starts", () => {
  const state = createEvidenceBudgetState(budget);
  assert.throws(
    () => reserveEvidenceAction(state, { kind: "SEMANTIC_EVALUATION", reserve_cost_usd: 0.010000000001 }),
    /hard_cost_ceiling_exceeded/
  );
});

check("settled spend remains committed when later work reserves budget", () => {
  let state = createEvidenceBudgetState(budget);
  state = reserveEvidenceAction(state, { kind: "SEMANTIC_EVALUATION", reserve_cost_usd: 0.006 });
  state = settleEvidenceAction(state, { reserved_cost_usd: 0.006, actual_cost_usd: 0.006 });
  assert.throws(
    () => reserveEvidenceAction(state, { kind: "SEMANTIC_EVALUATION", reserve_cost_usd: 0.004000000001 }),
    /hard_cost_ceiling_exceeded/
  );
});

check("unknown or invalid cost reservations are rejected", () => {
  const state = createEvidenceBudgetState(budget);
  assert.throws(
    () => reserveEvidenceAction(state, { kind: "SEMANTIC_EVALUATION" }),
    /invalid_reserve_cost_usd/
  );
});

check("actual spend cannot exceed its reservation", () => {
  let state = createEvidenceBudgetState(budget);
  state = reserveEvidenceAction(state, { kind: "SEMANTIC_EVALUATION", reserve_cost_usd: 0.002 });
  assert.throws(
    () => settleEvidenceAction(state, { reserved_cost_usd: 0.002, actual_cost_usd: 0.003 }),
    /actual_exceeds_reservation/
  );
});

check("closed budget cannot accept new work", () => {
  const state = closeEvidenceBudget(createEvidenceBudgetState(budget), "VERDICT_FINALIZED");
  assert.throws(
    () => reserveEvidenceAction(state, { kind: "CANDIDATE_QUERY", reserve_cost_usd: 0 }),
    /evidence_budget_closed:VERDICT_FINALIZED/
  );
});

console.log(`SUCCESS: ${checks} evidence budget checks passed.`);
