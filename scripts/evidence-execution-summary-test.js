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

const discoveryPlan = {
  version: "proofttl-evidence-plan-v1",
  status: "PLANNED",
  contradiction_pass_required: false,
  query_intents: [{ purpose: "PRIMARY_SUPPORT_OR_REFUTATION" }]
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
  const summary = summarizeEvidenceExecution({
    evidence_plan: discoveryPlan,
    action_results: [completed("SOURCE_FETCH", "source:without-discovery")]
  });
  assert.equal(summary.execution_status, "DISCOVERY_PASS_INCOMPLETE");
  assert.equal(summary.discovery_pass_required, true);
  assert.equal(summary.discovery_pass_completed, false);
}

{
  const summary = summarizeEvidenceExecution({
    evidence_plan: discoveryPlan,
    action_results: [completed("CANDIDATE_QUERY", "candidate:discovery")]
  });
  assert.equal(summary.execution_status, "COMPLETE");
  assert.equal(summary.discovery_pass_required, true);
  assert.equal(summary.discovery_pass_completed, true);
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

{
  const first = completed("SOURCE_FETCH", "source:nested-order");
  first.reservation.accounting = { reserved: { usd: 0.02, provider: "alpha" }, tags: ["a", "b"] };
  const second = completed("SOURCE_FETCH", "source:nested-order");
  second.reservation.accounting = { tags: ["a", "b"], reserved: { provider: "alpha", usd: 0.02 } };
  const summary = summarizeEvidenceExecution({ evidence_plan: optionalPlan, action_results: [first, second] });
  assert.equal(summary.execution_status, "COMPLETE");
  assert.equal(summary.executed_action_count, 1);
}

{
  const settledReplay = {
    status: "ALREADY_SETTLED",
    denial: null,
    reservation: {
      kind: "CONTRADICTION_QUERY",
      idempotency_key: "contradiction:replay",
      status: "SETTLED",
      outcome: "COMPLETED"
    }
  };
  const summary = summarizeEvidenceExecution({
    evidence_plan: requiredPlan,
    action_results: [settledReplay]
  });
  assert.equal(summary.execution_status, "COMPLETE");
  assert.equal(summary.executed_action_count, 1);
  assert.equal(summary.completed_action_count, 1);
  assert.equal(summary.contradiction_pass_completed, true);
}

{
  const reservedReplay = {
    status: "ALREADY_RESERVED",
    denial: null,
    reservation: {
      kind: "SOURCE_FETCH",
      idempotency_key: "source:pending",
      status: "RESERVED",
      outcome: null
    }
  };
  const summary = summarizeEvidenceExecution({
    evidence_plan: optionalPlan,
    action_results: [reservedReplay]
  });
  assert.equal(summary.execution_status, "EXECUTION_INCOMPLETE");
  assert.equal(summary.executed_action_count, 0);
  assert.equal(summary.completed_action_count, 0);
  assert.deepEqual(summary.failures, [{
    kind: "SOURCE_FETCH",
    idempotency_key: "source:pending",
    outcome: "UNSETTLED"
  }]);
}

assert.throws(
  () => summarizeEvidenceExecution({
    evidence_plan: requiredPlan,
    action_results: [{
      status: "FAILED",
      denial: null,
      reservation: {
        kind: "CONTRADICTION_QUERY",
        idempotency_key: "contradiction:false-complete",
        status: "SETTLED",
        outcome: "COMPLETED"
      }
    }]
  }),
  /evidence_execution_failed_receipt_incoherent/
);

assert.throws(
  () => summarizeEvidenceExecution({
    evidence_plan: optionalPlan,
    action_results: [{
      status: "COMPLETED",
      denial: null,
      reservation: {
        kind: "SOURCE_FETCH",
        idempotency_key: "source:false-complete",
        status: "SETTLED",
        outcome: "FAILED"
      }
    }]
  }),
  /evidence_execution_completed_receipt_incoherent/
);

assert.throws(
  () => summarizeEvidenceExecution({
    evidence_plan: optionalPlan,
    action_results: [{
      status: "DENIED",
      reservation: null,
      denial: {
        version: "wrong-version",
        code: "MAX_SOURCE_FETCHES_EXCEEDED",
        kind: "SOURCE_FETCH",
        idempotency_key: "source:bad-denial"
      }
    }]
  }),
  /evidence_execution_denial_version_invalid/
);

assert.throws(
  () => summarizeEvidenceExecution({
    evidence_plan: optionalPlan,
    action_results: [{
      status: "FAILED",
      denial: {
        version: "proofttl-evidence-budget-denial-v1",
        code: "MAX_SOURCE_FETCHES_EXCEEDED",
        kind: "SOURCE_FETCH",
        idempotency_key: "source:mixed"
      },
      reservation: {
        kind: "SOURCE_FETCH",
        idempotency_key: "source:mixed",
        status: "SETTLED",
        outcome: "FAILED"
      }
    }]
  }),
  /evidence_execution_receipt_mixed_outcome/
);

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
