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
const pricing = { candidate_query: 0.001, source_fetch: 0.002, semantic_evaluation: 0.003, contradiction_query: 0.001 };
const observed = "2026-09-05T12:00:00.000Z";

{
  const calls = [];
  const providers = {
    CANDIDATE_QUERY: async ({ request }) => {
      calls.push(["candidate", request.intent.purpose]);
      return { value: [{ source_url: "https://docs.acme.example/pricing" }] };
    },
    CONTRADICTION_QUERY: async ({ request }) => {
      calls.push(["contradiction", request.intent.purpose]);
      return { value: [{ source_url: "https://watch.example/acme-pricing" }] };
    },
    SOURCE_FETCH: async ({ request }) => {
      calls.push(["fetch", request.candidate.discovery_provenance]);
      return { value: { source_url: request.candidate.source_url, text: "pricing evidence" } };
    },
    SEMANTIC_EVALUATION: async ({ request }) => {
      calls.push(["semantic", request.source.discovery_provenance]);
      const primary = request.source.source_url.includes("docs.acme.example");
      return { value: {
        source_url: request.source.source_url,
        publisher: primary ? "Acme Corporation" : "Pricing Watch",
        source_type: primary ? "PRIMARY" : "SECONDARY",
        entailment: "FULL_SUPPORT",
        stance: "FOR",
        authority_score: 0.98,
        directness_score: 0.98,
        specificity_score: 0.98,
        independence_score: 0.9,
        reputation_score: 0.95,
        observed_at: observed,
        provenance: { evidence_excerpt: "Acme Pro costs $20 per month." }
      } };
    }
  };

  const result = await executeEvidencePlan({ claim_contract: claim, pricing, providers });
  assert.equal(result.outcome.execution_status, "COMPLETE");
  assert.equal(result.outcome.verdict, "SUPPORTED");
  assert.equal(result.outcome.execution_summary.contradiction_pass_completed, true);
  assert.equal(result.evidence_items.length, 2);
  assert.equal(result.evidence_items[0].provenance.discovery_provenance, "PRIMARY_DISCOVERY");
  assert.equal(result.evidence_items[1].provenance.discovery_provenance, "ADVERSARIAL_CONTRADICTION");
  assert.ok(calls.some(([kind]) => kind === "candidate"));
  assert.ok(calls.some(([kind]) => kind === "contradiction"));
  assert.ok(calls.some(([kind, provenance]) => kind === "fetch" && provenance === "ADVERSARIAL_CONTRADICTION"));
}

{
  const result = await executeEvidencePlan({
    claim_contract: claim,
    pricing,
    providers: {
      CANDIDATE_QUERY: async () => ({ value: [{ source_url: "not-a-url" }] }),
      CONTRADICTION_QUERY: async () => ({ value: [] })
    }
  });
  const discovery = result.action_results.find((item) => item.reservation?.kind === "CANDIDATE_QUERY");
  assert.equal(discovery.status, "FAILED");
  assert.match(discovery.error_code, /EVIDENCE_PROVIDER_CONTRACT_INVALID_CANDIDATE_QUERY/);
  assert.equal(result.outcome.verdict, "UNKNOWN");
  assert.notEqual(result.outcome.execution_status, "COMPLETE");
}

{
  const result = await executeEvidencePlan({
    claim_contract: claim,
    pricing,
    hard_cost_ceiling_usd: 0,
    providers: {
      CANDIDATE_QUERY: async () => ({ value: [] }),
      CONTRADICTION_QUERY: async () => ({ value: [] })
    }
  });
  assert.ok(result.action_results.every((item) => item.status === "DENIED"));
  assert.equal(result.outcome.verdict, "UNKNOWN");
}

console.log("evidence orchestrator tests passed");