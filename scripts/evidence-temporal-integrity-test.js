import assert from "node:assert/strict";
import { assessEvidence } from "../src/evidence-quality.js";

const common = {
  source_url: "https://acme.example/security",
  source_type: "PRIMARY",
  entailment: "FULL_SUPPORT",
  stance: "FOR",
  authority_score: 1,
  directness_score: 1,
  specificity_score: 1,
  independence_score: 1,
  reputation_score: 1,
  provenance: { evidence_excerpt: "Acme supports the stated security capability." }
};

{
  const evidence = assessEvidence({
    ...common,
    published_at: "2099-01-01T00:00:00Z",
    observed_at: "2099-01-02T00:00:00Z"
  }, { volatility: "HIGH" });

  assert.equal(evidence.components.freshness > 0.9, true);
  assert.equal(evidence.accepted, false);
  assert.equal(evidence.reasons.includes("REJECTED_OBSERVATION_IN_FUTURE"), true);
}

{
  const evidence = assessEvidence({
    ...common,
    published_at: "2026-08-01T00:00:00Z",
    updated_at: "not-an-update-date",
    observed_at: "2026-08-29T12:00:00Z"
  }, { volatility: "HIGH" });

  assert.equal(evidence.accepted, false);
  assert.equal(evidence.reasons.includes("REJECTED_INVALID_UPDATE_TIMESTAMP"), true);
}

{
  const evidence = assessEvidence({
    ...common,
    published_at: "2026-08-20T00:00:00Z",
    updated_at: "2026-08-19T00:00:00Z",
    observed_at: "2026-08-29T12:00:00Z"
  }, { volatility: "HIGH" });

  assert.equal(evidence.accepted, false);
  assert.equal(evidence.reasons.includes("REJECTED_UPDATE_BEFORE_PUBLICATION"), true);
}

{
  const evidence = assessEvidence({
    ...common,
    published_at: "2026-08-20T00:00:00Z",
    updated_at: "2026-08-30T00:00:00Z",
    observed_at: "2026-08-29T12:00:00Z"
  }, { volatility: "HIGH" });

  assert.equal(evidence.components.freshness, 1);
  assert.equal(evidence.accepted, false);
  assert.equal(evidence.reasons.includes("REJECTED_UPDATE_AFTER_OBSERVATION"), true);
}

{
  const evidence = assessEvidence({
    ...common,
    published_at: "2026-08-01T00:00:00Z",
    updated_at: "2026-08-29T00:00:00Z",
    observed_at: "2026-08-29T12:00:00Z"
  }, { volatility: "HIGH" });

  assert.equal(evidence.accepted, true);
  assert.equal(evidence.published_at, "2026-08-01T00:00:00.000Z");
  assert.equal(evidence.updated_at, "2026-08-29T00:00:00.000Z");
  assert.equal(evidence.components.freshness > 0.95, true);
}

console.log("ok - evidence publication/update chronology is validated independently");
