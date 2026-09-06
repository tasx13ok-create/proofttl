import assert from "node:assert/strict";
import { assessEvidence } from "../src/evidence-quality.js";

const evidence = assessEvidence({
  source_url: "https://acme.example/security",
  source_type: "PRIMARY",
  published_at: "2099-01-01T00:00:00Z",
  observed_at: "2099-01-02T00:00:00Z",
  entailment: "FULL_SUPPORT",
  stance: "FOR",
  authority_score: 1,
  directness_score: 1,
  specificity_score: 1,
  independence_score: 1,
  reputation_score: 1,
  provenance: { evidence_excerpt: "Acme supports the stated security capability." }
}, { volatility: "HIGH" });

assert.equal(evidence.components.freshness > 0.9, true);
assert.equal(evidence.accepted, false);
assert.equal(evidence.reasons.includes("REJECTED_OBSERVATION_IN_FUTURE"), true);

console.log("ok - future observation timestamps are rejected from the evidence ledger");
