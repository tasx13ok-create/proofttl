import assert from "node:assert/strict";
import { executeEvidencePlan } from "../src/evidence-orchestrator.js";

const claim = {
  version: "proofttl-claim-contract-v1",
  normalized_claim: "Acme Pro costs $20 per month",
  verification_priority: "CRITICAL",
  volatility: { level: "MEDIUM", reason: "COMMERCIAL_DYNAMIC" },
  risk_if_wrong: { level: "HIGH", score: 5, signals: ["MONEY"] },
  ambiguities: []
};

const pricing = {
  candidate_query: 0.001,
  source_fetch: 0.002,
  semantic_evaluation: 0.003,
  contradiction_query: 0.001
};
const observed = "2026-09-05T12:00:00.000Z";
const primaryPurposes = [];

const result = await executeEvidencePlan({
  claim_contract: claim,
  pricing,
  validate_source_url: async () => ({ ok: true }),
  providers: {
    CANDIDATE_QUERY: async ({ request }) => {
      primaryPurposes.push(request.intent.purpose);
      return { value: [{ source_url: `https://primary-${primaryPurposes.length}.example/evidence` }] };
    },
    CONTRADICTION_QUERY: async ({ request }) => {
      assert.equal(request.intent.purpose, "ADVERSARIAL_CONTRADICTION");
      return { value: [{ source_url: "https://counter.example/evidence" }] };
    },
    SOURCE_FETCH: async ({ request }) => ({
      value: { source_url: request.candidate.source_url, text: "bounded evidence" }
    }),
    SEMANTIC_EVALUATION: async ({ request }) => ({
      value: {
        source_url: request.source.source_url,
        publisher: "Lineage Test Publisher",
        source_type: "SECONDARY",
        entailment: "CONTEXT_ONLY",
        stance: "AMBIGUOUS",
        authority_score: 0.8,
        directness_score: 0.8,
        specificity_score: 0.8,
        independence_score: 0.8,
        reputation_score: 0.8,
        observed_at: observed,
        provenance: { evidence_excerpt: "Intent lineage inspected." }
      }
    })
  }
});

assert.ok(primaryPurposes.length > 0, "the generated high-assurance plan should execute primary discovery");
const primary = result.evidence_items.find((item) => item.provenance.discovery_provenance === "PRIMARY_DISCOVERY");
const adversarial = result.evidence_items.find((item) => item.provenance.discovery_provenance === "ADVERSARIAL_CONTRADICTION");
assert.ok(primary, "primary evidence must survive into the ledger input");
assert.ok(adversarial, "adversarial evidence must survive into the ledger input");
assert.ok(primaryPurposes.includes(primary.provenance.discovery_intent_purpose));
assert.equal(primary.provenance.discovery_intent_index, 0);
assert.equal(adversarial.provenance.discovery_intent_purpose, "ADVERSARIAL_CONTRADICTION");
assert.equal(adversarial.provenance.discovery_intent_index, 0);

console.log("evidence intent lineage tests passed");
