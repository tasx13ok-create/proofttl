import assert from "node:assert/strict";
import { deriveExecutedVerificationOutcome } from "../src/verification-context.js";

const claimContract = {
  version: "proofttl-claim-contract-v1",
  normalized_claim: "Acme Pro costs $20 per month",
  verification_priority: "CRITICAL",
  volatility: { level: "MEDIUM", reason: "COMMERCIAL_DYNAMIC" },
  risk_if_wrong: { level: "HIGH", score: 5, signals: ["MONEY"] },
  ambiguities: []
};

const supportEvidence = [{
  source_url: "https://docs.acme.example/pricing",
  publisher: "Acme Corporation",
  underlying_source_id: "sha256:pricing",
  source_type: "PRIMARY",
  entailment: "FULL_SUPPORT",
  stance: "FOR",
  authority_score: 0.98,
  directness_score: 0.98,
  specificity_score: 0.98,
  independence_score: 0.9,
  reputation_score: 0.95,
  observed_at: "2026-09-05T08:00:00.000Z",
  provenance: { evidence_excerpt: "Acme Pro costs $20 per month." }
}];

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
  const outcome = deriveExecutedVerificationOutcome({
    claim_contract: claimContract,
    evidence_items: supportEvidence,
    action_results: [
      completed("CANDIDATE_QUERY", "candidate:primary"),
      completed("SOURCE_FETCH", "fetch:primary"),
      completed("SEMANTIC_EVALUATION", "semantic:primary"),
      completed("CONTRADICTION_QUERY", "contradiction:adversarial")
    ]
  });

  assert.equal(outcome.evidence_verdict, "SUPPORTED");
  assert.equal(outcome.verdict, "SUPPORTED");
  assert.equal(outcome.execution_status, "COMPLETE");
  assert.equal(outcome.execution_summary.execution_status, "COMPLETE");
  assert.equal(outcome.execution_summary.contradiction_pass_required, true);
  assert.equal(outcome.execution_summary.contradiction_pass_completed, true);
  assert.equal(outcome.execution_summary.executed_action_count, 4);
}

{
  const outcome = deriveExecutedVerificationOutcome({
    claim_contract: claimContract,
    evidence_items: supportEvidence,
    action_results: [completed("SEMANTIC_EVALUATION", "semantic:without-countersearch")]
  });

  assert.equal(outcome.evidence_verdict, "SUPPORTED");
  assert.equal(outcome.verdict, "UNKNOWN");
  assert.equal(outcome.execution_status, "CONTRADICTION_PASS_INCOMPLETE");
  assert.equal(outcome.execution_summary.contradiction_pass_completed, false);
  assert.equal(outcome.confidence, null);
}

{
  const outcome = deriveExecutedVerificationOutcome({
    claim_contract: claimContract,
    evidence_items: supportEvidence,
    action_results: [{
      status: "FAILED",
      error_code: "UPSTREAM_TIMEOUT",
      denial: null,
      reservation: {
        kind: "CONTRADICTION_QUERY",
        idempotency_key: "contradiction:timeout",
        status: "SETTLED",
        outcome: "TIMEOUT"
      }
    }]
  });

  assert.equal(outcome.evidence_verdict, "SUPPORTED");
  assert.equal(outcome.verdict, "UNKNOWN");
  assert.equal(outcome.execution_status, "CONTRADICTION_PASS_INCOMPLETE");
  assert.equal(outcome.execution_summary.execution_status, "EXECUTION_INCOMPLETE");
  assert.equal(outcome.execution_failures.length, 1);
  assert.equal(outcome.execution_failures[0].outcome, "TIMEOUT");
}

{
  const outcome = deriveExecutedVerificationOutcome({
    claim_contract: claimContract,
    evidence_items: supportEvidence,
    action_results: [],
    evidence_plan: {
      version: "proofttl-evidence-plan-v1",
      status: "PLANNED",
      contradiction_pass_required: false
    }
  });

  assert.equal(outcome.evidence_verdict, "SUPPORTED");
  assert.equal(outcome.execution_summary.execution_status, "NOT_EXECUTED");
  assert.equal(outcome.execution_status, "NOT_EXECUTED");
  assert.equal(outcome.verdict, "UNKNOWN");
  assert.equal(outcome.confidence, null);
  assert.equal(outcome.confidence_status, "WITHHELD_EXECUTION_INCOMPLETE");
}

console.log("executed verification outcome tests passed");
