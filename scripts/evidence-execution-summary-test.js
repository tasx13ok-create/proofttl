import assert from "node:assert/strict";
import { summarizeEvidenceExecution } from "../src/evidence-execution-summary.js";

const requiredPlan = {
  version: "proofttl-evidence-plan-v1",
  status: "PLANNED",
  contradiction_pass_required: true
};

const optionalPlan = {
  version: "proofttl-evidence-plan-v1",
  status: "PLANNED",
  contradiction_pass_required: false
};

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

{
  const summary = summarizeEvidenceExecution({
    evidence_plan: requiredPlan,
    action_results: [
      completed("CANDIDATE_QUERY", "candidate:1"),
      completed("CONTRADICTION_QUERY", "contradiction:1")
    ]
  });
  assert.equal(summary.execution_status, "COMPLETE");
  assert.equal(summary.executed_action_count, 2);
  assert.equal(summary.completed_action_count, 2);
  assert.equal(summary.contradiction_pass_required, true);
  assert.equal(summary.contradiction_pass_completed, true);
  assert.deepEqual(summary.denials, []);
  assert.deepEqual(summary.failures, []);
}

{
  const summary = summarizeEvidenceExecution({
    evidence_plan: requiredPlan,
    action_results: [completed("CANDIDATE_QUERY", "candidate:only")]
  });
  assert.equal(summary.execution_status, "CONTRADICTION_PASS_INCOMPLETE");
  assert.equal(summary.contradiction_pass_completed, false);
}

{
  const failedContradiction = {
    status: "FAILED",
    denial: null,
    error_code: "ETIMEDOUT",
    reservation: {
      kind: "CONTRADICTION_QUERY",
      idempotency_key: "contradiction:timeout",
      status: "SETTLED",
      outcome: "TIMEOUT"
    }
  };
  const summary = summarizeEvidenceExecution({
    evidence_plan: requiredPlan,
    action_results: [failedContradiction]
  });
  assert.equal(summary.execution_status, "EXECUTION_INCOMPLETE");
  assert.equal(summary.executed_action_count, 1);
  assert.equal(summary.completed_action_count, 0);
  assert.equal(summary.contradiction_pass_completed, false);
  assert.deepEqual(summary.failures, [{
    kind: "CONTRADICTION_QUERY",
    idempotency_key: "contradiction:timeout",
    outcome: "TIMEOUT"
  }]);
}

{
  const denial = {
    status: "DENIED",
    reservation: null,
    value: null,
    denial: {
      version: "proofttl-evidence-budget-denial-v1",
      code: "MAX_SOURCE_FETCHES_EXCEEDED",
      kind: "SOURCE_FETCH",
      idempotency_key: "source:denied"
    }
  };
  const summary = summarizeEvidenceExecution({
    evidence_plan: optionalPlan,
    action_results: [denial]
  });
  assert.equal(summary.execution_status, "BUDGET_TRUNCATED");
  assert.equal(summary.executed_action_count, 0);
  assert.equal(summary.completed_action_count, 0);
  assert.equal(summary.denials.length, 1);
}

{
  const replay = completed("SOURCE_FETCH", "source:stable");
  const summary = summarizeEvidenceExecution({
    evidence_plan: optionalPlan,
    action_results: [replay, structuredClone(replay)]
  });
  assert.equal(summary.execution_status, "COMPLETE");
  assert.equal(summary.executed_action_count, 1);
  assert.equal(summary.completed_action_count, 1);
}

assert.throws(
  () => summarizeEvidenceExecution({
    evidence_plan: optionalPlan,
    action_results: [
      completed("SOURCE_FETCH", "source:conflict"),
      {
        status: "FAILED",
        reservation: {
          kind: "SOURCE_FETCH",
          idempotency_key: "source:conflict",
          status: "SETTLED",
          outcome: "FAILED"
        }
      }
    ]
  }),
  /evidence_execution_receipt_conflict/
);

{
  const summary = summarizeEvidenceExecution({
    evidence_plan: {
      version: "proofttl-evidence-plan-v1",
      status: "NOT_SCHEDULED",
      contradiction_pass_required: false
    },
    action_results: []
  });
  assert.equal(summary.execution_status, "NOT_EXECUTED");
  assert.equal(summary.executed_action_count, 0);
}

console.log("evidence execution summary tests passed");
