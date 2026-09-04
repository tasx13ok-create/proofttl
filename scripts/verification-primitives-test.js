import assert from "node:assert/strict";
import { decomposeInput, classifyFragment, atomicFragments } from "../src/claim-decomposition.js";
import { assessEvidence, aggregateEvidence, deriveVerdict } from "../src/evidence-quality.js";
import { finalizeVerificationOutcome } from "../src/verification-outcome.js";

let checks = 0;
function check(name, fn) {
  fn();
  checks += 1;
  console.log(`ok ${checks} - ${name}`);
}

const now = Date.parse("2026-08-29T12:00:00Z");

check("opinion is skipped instead of wasting verification work", () => {
  assert.deepEqual(classifyFragment("I think this product is amazing."), { verifiable: false, reason: "OPINION" });
});

check("quantified factual statement is considered verifiable", () => {
  assert.equal(classifyFragment("Acme reported $42 million in revenue in 2025.").verifiable, true);
});

check("long input becomes separate claim candidates", () => {
  const result = decomposeInput(
    "Acme reported $42 million in revenue in 2025. Acme currently supports SAML SSO on its Pro plan. I think the product is amazing.",
    { nowMs: now }
  );
  assert.equal(result.claim_count, 2);
  assert.equal(result.skipped_count, 1);
  assert.equal(result.claims[0].claim_id, "c01");
  assert.equal(result.claims[1].volatility.level, "HIGH");
  assert.equal(result.skipped[0].reason, "OPINION");
});

check("duplicate fragments are removed deterministically", () => {
  assert.equal(atomicFragments("Acme was founded in 2018. Acme was founded in 2018.").length, 1);
});

check("claim decomposition emits a structured proposition where grammar permits", () => {
  const result = decomposeInput("Acme currently supports SAML SSO on its Pro plan.", { nowMs: now });
  assert.equal(result.claims[0].proposition.subject, "Acme currently");
  assert.equal(result.claims[0].proposition.predicate, "supports");
  assert.equal(result.claims[0].proposition.object_or_value, "SAML SSO on its Pro plan");
});

check("primary direct evidence receives a strong explainable score", () => {
  const evidence = assessEvidence({
    source_url: "https://acme.example/security",
    source_type: "PRIMARY",
    published_at: "2026-08-28T00:00:00Z",
    observed_at: "2026-08-29T12:00:00Z",
    entailment: "FULL_SUPPORT",
    stance: "FOR",
    authority_score: 0.95,
    independence_score: 0.65,
    reputation_score: 0.9
  }, { volatility: "HIGH" });
  assert.equal(evidence.accepted, true);
  assert.ok(evidence.quality_score > 0.7);
  assert.equal(evidence.components.freshness > 0.9, true);
});

check("high-scoring evidence without a traceable HTTP source is rejected", () => {
  const evidence = assessEvidence({
    source_url: "internal-memory-only",
    source_type: "PRIMARY",
    entailment: "FULL_SUPPORT",
    stance: "FOR",
    authority_score: 1,
    directness_score: 1,
    specificity_score: 1,
    independence_score: 1,
    reputation_score: 1
  });
  assert.equal(evidence.quality_score > 0.7, true);
  assert.equal(evidence.accepted, false);
  assert.equal(evidence.reasons.includes("REJECTED_UNTRACEABLE_SOURCE"), true);
});

check("untraceable evidence cannot manufacture a definitive ledger verdict", () => {
  const ledger = aggregateEvidence([{
    source_url: "not-a-source-url",
    publisher: "Acme",
    source_type: "PRIMARY",
    entailment: "FULL_SUPPORT",
    stance: "FOR",
    authority_score: 1,
    directness_score: 1,
    specificity_score: 1,
    independence_score: 1,
    reputation_score: 1
  }]);
  assert.equal(ledger.verdict, "UNKNOWN");
  assert.equal(ledger.metrics.accepted_count, 0);
  assert.equal(ledger.metrics.rejected_count, 1);
  assert.equal(ledger.metrics.independent_support_groups, 0);
});

check("old evidence is penalized more aggressively for volatile claims", () => {
  const high = assessEvidence({
    source_url: "https://example.com/old",
    published_at: "2024-08-29T00:00:00Z",
    observed_at: "2026-08-29T12:00:00Z",
    entailment: "FULL_SUPPORT"
  }, { volatility: "HIGH" });
  const low = assessEvidence({
    source_url: "https://example.com/old",
    published_at: "2024-08-29T00:00:00Z",
    observed_at: "2026-08-29T12:00:00Z",
    entailment: "FULL_SUPPORT"
  }, { volatility: "LOW" });
  assert.ok(high.components.freshness < low.components.freshness);
});

check("mirrors of the same underlying report do not count as independent corroboration", () => {
  const ledger = aggregateEvidence([
    {
      source_url: "https://news-a.example/report",
      underlying_source_id: "report-42",
      entailment: "FULL_SUPPORT",
      stance: "FOR",
      authority_score: 0.9,
      directness_score: 0.9,
      specificity_score: 0.9,
      independence_score: 0.9,
      reputation_score: 0.9
    },
    {
      source_url: "https://news-b.example/copied-report",
      underlying_source_id: "report-42",
      entailment: "FULL_SUPPORT",
      stance: "FOR",
      authority_score: 0.8,
      directness_score: 0.85,
      specificity_score: 0.85,
      independence_score: 0.8,
      reputation_score: 0.8
    }
  ]);
  assert.equal(ledger.evidence_for.length, 1);
  assert.equal(ledger.metrics.independent_support_groups, 1);
});

check("strong contradiction can produce CONTRADICTED without decorative confidence", () => {
  const ledger = aggregateEvidence([
    {
      source_url: "https://acme.example/pricing",
      source_type: "PRIMARY",
      entailment: "CONTRADICTORY",
      stance: "AGAINST",
      authority_score: 0.98,
      directness_score: 0.98,
      specificity_score: 0.98,
      independence_score: 0.8,
      reputation_score: 0.95
    }
  ]);
  assert.equal(ledger.verdict, "CONTRADICTED");
  assert.ok(ledger.confidence > 0.4 && ledger.confidence < 1);
});

check("mixed high-quality evidence remains UNKNOWN instead of manufacturing certainty", () => {
  const ledger = aggregateEvidence([
    {
      source_url: "https://primary-a.example/source",
      source_type: "PRIMARY",
      entailment: "FULL_SUPPORT",
      stance: "FOR",
      authority_score: 0.95,
      directness_score: 0.95,
      specificity_score: 0.95,
      independence_score: 0.9,
      reputation_score: 0.9
    },
    {
      source_url: "https://primary-b.example/source",
      source_type: "PRIMARY",
      entailment: "CONTRADICTORY",
      stance: "AGAINST",
      authority_score: 0.95,
      directness_score: 0.95,
      specificity_score: 0.95,
      independence_score: 0.9,
      reputation_score: 0.9
    }
  ]);
  assert.equal(ledger.verdict, "UNKNOWN");
});

check("verdict derivation refuses support when evidence strength is weak", () => {
  assert.equal(deriveVerdict({ support: 0.5, contradiction: 0.1, independentSupport: 2 }), "UNKNOWN");
});

check("budget truncation withholds a definitive final verdict while preserving the evidence verdict", () => {
  const ledger = aggregateEvidence([{
    source_url: "https://acme.example/about",
    source_type: "PRIMARY",
    entailment: "FULL_SUPPORT",
    stance: "FOR",
    authority_score: 0.98,
    directness_score: 0.98,
    specificity_score: 0.98,
    independence_score: 0.9,
    reputation_score: 0.95
  }]);
  assert.equal(ledger.verdict, "SUPPORTED");
  const outcome = finalizeVerificationOutcome({
    evidence_ledger: ledger,
    execution: {
      contradiction_pass_required: false,
      contradiction_pass_completed: true,
      denials: [{
        version: "proofttl-evidence-budget-denial-v1",
        code: "BUDGET_EXCEEDED",
        kind: "SOURCE_FETCH",
        idempotency_key: "fetch:2"
      }]
    }
  });
  assert.equal(outcome.evidence_verdict, "SUPPORTED");
  assert.equal(outcome.verdict, "UNKNOWN");
  assert.equal(outcome.execution_status, "BUDGET_TRUNCATED");
  assert.equal(outcome.confidence, null);
});

check("provider execution failure withholds a definitive final verdict while preserving contradiction evidence", () => {
  const ledger = aggregateEvidence([{
    source_url: "https://acme.example/pricing",
    source_type: "PRIMARY",
    entailment: "CONTRADICTORY",
    stance: "AGAINST",
    authority_score: 0.98,
    directness_score: 0.98,
    specificity_score: 0.98,
    independence_score: 0.9,
    reputation_score: 0.95
  }]);
  assert.equal(ledger.verdict, "CONTRADICTED");
  const outcome = finalizeVerificationOutcome({
    evidence_ledger: ledger,
    execution: {
      contradiction_pass_required: false,
      contradiction_pass_completed: true,
      failures: [{
        kind: "SEMANTIC_CHECK",
        idempotency_key: "semantic:2",
        outcome: "PROVIDER_TIMEOUT"
      }]
    }
  });
  assert.equal(outcome.evidence_verdict, "CONTRADICTED");
  assert.equal(outcome.verdict, "UNKNOWN");
  assert.equal(outcome.execution_status, "EXECUTION_INCOMPLETE");
  assert.equal(outcome.confidence_status, "WITHHELD_EXECUTION_INCOMPLETE");
});

console.log(`SUCCESS: ${checks} verification primitive checks passed.`);
