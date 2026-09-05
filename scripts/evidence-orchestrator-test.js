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
const allowPublic = async () => ({ ok: true });

{
  const calls = [];
  let safetyCalls = 0;
  const providers = {
    CANDIDATE_QUERY: async ({ request }) => {
      calls.push(["candidate", request.intent.purpose]);
      return { value: [Object.freeze({ source_url: "https://docs.acme.example/pricing" })] };
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

  const result = await executeEvidencePlan({
    claim_contract: claim,
    pricing,
    providers,
    validate_source_url: async () => { safetyCalls += 1; return { ok: true }; }
  });
  assert.equal(result.outcome.execution_status, "COMPLETE");
  assert.equal(result.outcome.verdict, "SUPPORTED");
  assert.equal(result.outcome.execution_summary.contradiction_pass_completed, true);
  assert.equal(result.evidence_items.length, 2);
  assert.equal(result.evidence_items[0].provenance.discovery_provenance, "PRIMARY_DISCOVERY");
  assert.equal(result.evidence_items[1].provenance.discovery_provenance, "ADVERSARIAL_CONTRADICTION");
  assert.equal(result.evidence_items[0].provenance.discovery_source_url, "https://docs.acme.example/pricing");
  assert.equal(safetyCalls, 2, "source safety validation should be cached per normalized URL across stages");
  assert.ok(calls.some(([kind]) => kind === "candidate"));
  assert.ok(calls.some(([kind]) => kind === "contradiction"));
  assert.ok(calls.some(([kind, provenance]) => kind === "fetch" && provenance === "ADVERSARIAL_CONTRADICTION"));
}

{
  const result = await executeEvidencePlan({
    claim_contract: claim,
    pricing,
    validate_source_url: allowPublic,
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
    validate_source_url: allowPublic,
    providers: {
      CANDIDATE_QUERY: async () => ({ value: [] }),
      CONTRADICTION_QUERY: async () => ({ value: [] })
    }
  });
  assert.ok(result.action_results.every((item) => item.status === "DENIED"));
  assert.equal(result.outcome.verdict, "UNKNOWN");
}

{
  const result = await executeEvidencePlan({
    claim_contract: claim,
    pricing,
    validate_source_url: async (url) => ({ ok: !String(url).includes("127.0.0.1"), reason: "source_ip_not_public" }),
    providers: {
      CANDIDATE_QUERY: async () => ({ value: [{ source_url: "http://127.0.0.1/admin" }] }),
      CONTRADICTION_QUERY: async () => ({ value: [] })
    }
  });
  const discovery = result.action_results.find((item) => item.reservation?.kind === "CANDIDATE_QUERY");
  assert.equal(discovery.status, "FAILED");
  assert.match(discovery.error_code, /UNSAFE_SOURCE_URL/);
  assert.equal(result.outcome.verdict, "UNKNOWN");
}

{
  const providers = {
    CANDIDATE_QUERY: async () => ({ value: [{ source_url: "https://docs.acme.example/pricing" }] }),
    CONTRADICTION_QUERY: async () => ({ value: [{ source_url: "https://watch.example/acme-pricing" }] }),
    SOURCE_FETCH: async ({ request }) => ({ value: { source_url: request.candidate.source_url, text: "pricing evidence" } }),
    SEMANTIC_EVALUATION: async () => ({ value: {
      source_url: "https://unrelated.example/injected",
      publisher: "Injected",
      source_type: "SECONDARY",
      entailment: "FULL_SUPPORT",
      stance: "FOR",
      authority_score: 1,
      directness_score: 1,
      specificity_score: 1,
      independence_score: 1,
      reputation_score: 1,
      observed_at: observed,
      provenance: { evidence_excerpt: "Acme Pro costs $20 per month." }
    } })
  };
  const result = await executeEvidencePlan({ claim_contract: claim, pricing, providers, validate_source_url: allowPublic });
  const semantic = result.action_results.find((item) => item.reservation?.kind === "SEMANTIC_EVALUATION");
  assert.equal(semantic.status, "FAILED");
  assert.match(semantic.error_code, /SEMANTIC_RESULT_NOT_BOUND_TO_SOURCE/);
  assert.equal(result.outcome.verdict, "UNKNOWN");
  assert.notEqual(result.outcome.execution_status, "COMPLETE");
}

{
  const providers = {
    CANDIDATE_QUERY: async () => ({ value: [{ source_url: "https://docs.acme.example/pricing" }] }),
    CONTRADICTION_QUERY: async () => ({ value: [{ source_url: "https://watch.example/acme-pricing" }] }),
    SOURCE_FETCH: async () => ({ value: { source_url: "https://unrelated.example/fetched", text: "wrong source" } })
  };
  const result = await executeEvidencePlan({ claim_contract: claim, pricing, providers, validate_source_url: allowPublic });
  const fetchResult = result.action_results.find((item) => item.reservation?.kind === "SOURCE_FETCH");
  assert.equal(fetchResult.status, "FAILED");
  assert.match(fetchResult.error_code, /SOURCE_FETCH_NOT_BOUND_TO_CANDIDATE/);
  assert.equal(result.outcome.verdict, "UNKNOWN");
}

{
  const providers = {
    CANDIDATE_QUERY: async () => ({ value: [{ source_url: "https://docs.acme.example/pricing" }] }),
    CONTRADICTION_QUERY: async () => ({ value: [] }),
    SOURCE_FETCH: async ({ request }) => ({ value: {
      source_url: "https://unrelated.example/fetched",
      requested_source_url: request.candidate.source_url,
      text: "wrong source with spoofed request metadata"
    } })
  };
  const result = await executeEvidencePlan({ claim_contract: claim, pricing, providers, validate_source_url: allowPublic });
  const fetchResult = result.action_results.find((item) => item.reservation?.kind === "SOURCE_FETCH");
  assert.equal(fetchResult.status, "FAILED");
  assert.match(fetchResult.error_code, /SOURCE_FETCH_NOT_BOUND_TO_CANDIDATE/);
  assert.equal(result.outcome.verdict, "UNKNOWN");
}

{
  const calls = [];
  const manyPrimaryCandidates = Array.from({ length: 20 }, (_, index) => ({
    source_url: `https://primary-${index}.example/evidence`
  }));
  const providers = {
    CANDIDATE_QUERY: async () => ({ value: manyPrimaryCandidates }),
    CONTRADICTION_QUERY: async () => ({ value: [{ source_url: "https://counter.example/evidence" }] }),
    SOURCE_FETCH: async ({ request }) => {
      calls.push(["fetch", request.candidate.discovery_provenance, request.candidate.source_url]);
      return { value: { source_url: request.candidate.source_url, text: "bounded evidence" } };
    },
    SEMANTIC_EVALUATION: async ({ request }) => {
      calls.push(["semantic", request.source.discovery_provenance, request.source.source_url]);
      return { value: {
        source_url: request.source.source_url,
        publisher: "Test Publisher",
        source_type: "SECONDARY",
        entailment: "CONTEXT_ONLY",
        stance: "AMBIGUOUS",
        authority_score: 0.8,
        directness_score: 0.8,
        specificity_score: 0.8,
        independence_score: 0.8,
        reputation_score: 0.8,
        observed_at: observed,
        provenance: { evidence_excerpt: "Context inspected." }
      } };
    }
  };

  const result = await executeEvidencePlan({ claim_contract: claim, pricing, providers, validate_source_url: allowPublic });
  assert.ok(
    calls.some(([kind, provenance, url]) => kind === "fetch" && provenance === "ADVERSARIAL_CONTRADICTION" && url === "https://counter.example/evidence"),
    "bounded fetch selection must reserve room for an adversarial candidate"
  );
  assert.ok(
    calls.some(([kind, provenance, url]) => kind === "semantic" && provenance === "ADVERSARIAL_CONTRADICTION" && url === "https://counter.example/evidence"),
    "adversarial candidates that survive fetch selection must also reach semantic evaluation"
  );
  assert.ok(result.evidence_items.some((item) => item.provenance.discovery_provenance === "ADVERSARIAL_CONTRADICTION"));
}

console.log("evidence orchestrator tests passed");