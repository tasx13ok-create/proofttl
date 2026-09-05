import assert from "node:assert/strict";
import { summarizeEvidenceExecution } from "../src/evidence-execution-summary.js";

const plan = (overrides = {}) => ({
  version: "proofttl-evidence-plan-v1",
  status: "PLANNED",
  contradiction_pass_required: false,
  execution_budget: {
    max_candidate_queries: 1,
    max_source_fetches: 1,
    max_semantic_evaluations: 1,
    max_contradiction_queries: 0
  },
  ...overrides
});

const completed = (kind, key) => ({
  status: "COMPLETED",
  denial: null,
  reservation: {
    kind,
    idempotency_key: key,
    status: "SETTLED",
    outcome: "COMPLETED"
  }
});

assert.throws(
  () => summarizeEvidenceExecution({
    evidence_plan: plan(),
    action_results: [completed("UNPLANNED_MAGIC", "magic:1")]
  }),
  /evidence_execution_receipt_kind_unsupported/
);

assert.throws(
  () => summarizeEvidenceExecution({
    evidence_plan: plan(),
    action_results: [completed("CONTRADICTION_QUERY", "contradiction:impossible")]
  }),
  /evidence_execution_receipts_exceed_plan_max_contradiction_queries/
);

assert.throws(
  () => summarizeEvidenceExecution({
    evidence_plan: plan(),
    action_results: [
      completed("SOURCE_FETCH", "fetch:1"),
      completed("SOURCE_FETCH", "fetch:2")
    ]
  }),
  /evidence_execution_receipts_exceed_plan_max_source_fetches/
);

{
  const replay = completed("SOURCE_FETCH", "fetch:stable");
  const summary = summarizeEvidenceExecution({
    evidence_plan: plan(),
    action_results: [
      replay,
      structuredClone(replay),
      completed("SEMANTIC_EVALUATION", "semantic:stable")
    ]
  });
  assert.equal(summary.execution_status, "COMPLETE");
  assert.equal(summary.executed_action_count, 2);
  assert.equal(summary.completed_action_count, 2);
}

console.log("evidence execution plan binding tests passed");
