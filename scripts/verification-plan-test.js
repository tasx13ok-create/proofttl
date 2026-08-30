import assert from "node:assert/strict";
import { buildClaimContract } from "../src/claim-contract.js";
import { buildEvidencePlan, triageClaimContract } from "../src/verification-plan.js";

let checks = 0;
function check(name, fn) {
  fn();
  checks += 1;
  console.log(`ok ${checks} - ${name}`);
}

check("triage costs zero external/model calls", () => {
  const contract = buildClaimContract("Acme currently supports SAML SSO on its Pro plan.", {
    nowMs: Date.parse("2026-08-30T12:00:00Z")
  });
  const triage = triageClaimContract(contract);
  assert.equal(triage.stage_contract.stage, "TRIAGE");
  assert.equal(triage.stage_contract.max_external_calls, 0);
  assert.equal(triage.stage_contract.max_model_calls, 0);
  assert.equal(triage.stage_contract.cost_ceiling_usd, 0);
  assert.equal(triage.stage_contract.failure_value, "DEFER_WITHOUT_VERDICT");
});

check("dynamic product claim earns broader retrieval without pretending it was verified", () => {
  const contract = buildClaimContract("Acme currently supports SAML SSO on its Pro plan.", {
    nowMs: Date.parse("2026-08-30T12:00:00Z")
  });
  const triage = triageClaimContract(contract);
  const plan = buildEvidencePlan(contract, triage);
  assert.equal(triage.decision, "VERIFY");
  assert.equal(plan.status, "PLANNED");
  assert.equal(plan.category, "COMMERCIAL_DYNAMIC");
  assert.ok(plan.execution_budget.max_source_fetches > 0);
  assert.equal(plan.failure_value, "UNKNOWN");
  assert.equal(plan.acceptance_requirements.retrieval_is_not_evidence, true);
});

check("high-risk compliance claim requires an adversarial contradiction pass", () => {
  const contract = buildClaimContract("Acme is SOC 2 certified and compliant with HIPAA.");
  const triage = triageClaimContract(contract);
  const plan = buildEvidencePlan(contract, triage);
  assert.equal(triage.verification_depth, "HIGH_ASSURANCE");
  assert.equal(triage.contradiction_pass_required, true);
  assert.equal(plan.category, "COMPLIANCE");
  assert.equal(plan.contradiction_pass_required, true);
  assert.ok(plan.query_intents.some((item) => item.purpose === "ADVERSARIAL_CONTRADICTION"));
});

check("low-risk historical claim stays on cheap primary lookup rung", () => {
  const contract = buildClaimContract("Ada Lovelace was born in 1815.");
  const triage = triageClaimContract(contract);
  const plan = buildEvidencePlan(contract, triage);
  assert.equal(contract.volatility.level, "LOW");
  assert.equal(triage.verification_depth, "PRIMARY_LOOKUP");
  assert.equal(plan.category, "HISTORICAL");
  assert.ok(plan.execution_budget.max_source_fetches <= 3);
});

check("explicit high-assurance request raises depth but still has a bounded execution envelope", () => {
  const contract = buildClaimContract("Acme had $42 million in revenue in 2025.");
  const triage = triageClaimContract(contract, { high_assurance: true });
  const plan = buildEvidencePlan(contract, triage);
  assert.equal(triage.verification_depth, "HIGH_ASSURANCE");
  assert.equal(plan.execution_budget.max_candidate_queries, 8);
  assert.equal(plan.execution_budget.max_source_fetches, 16);
  assert.equal(plan.execution_budget.max_semantic_evaluations, 16);
  assert.equal(plan.execution_budget.latency_budget_ms, 45000);
  assert.equal(plan.execution_budget.hard_cost_ceiling_usd, null);
  assert.equal(plan.execution_budget.hard_cost_ceiling_state, "REQUIRES_RUNTIME_PRICING_ENFORCEMENT");
});

check("planner refuses malformed Claim Contracts", () => {
  assert.throws(
    () => triageClaimContract({ version: "wrong", normalized_claim: "Acme exists" }),
    /triage_claim_contract_version_unsupported/
  );
});

check("query intents are bounded and contain explicit source-purpose metadata", () => {
  const contract = buildClaimContract("Acme currently charges $99 per month for its Enterprise plan.");
  const plan = buildEvidencePlan(contract);
  assert.ok(plan.query_intents.length <= 4);
  for (const intent of plan.query_intents) {
    assert.ok(intent.purpose);
    assert.ok(intent.source_class);
    assert.ok(intent.query.length <= 900);
  }
});

console.log(`SUCCESS: ${checks} verification planning checks passed.`);
