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
const sourceUrl = "https://docs.acme.example/pricing";

function providersFor(connectedAddress, inspectBinding = null) {
  return {
    CANDIDATE_QUERY: async () => ({ value: [{ source_url: sourceUrl }] }),
    CONTRADICTION_QUERY: async () => ({ value: [] }),
    SOURCE_FETCH: async ({ request }) => {
      if (inspectBinding) inspectBinding(request.source_network_binding);
      return {
        value: {
          source_url: request.candidate.source_url,
          connected_address: connectedAddress,
          text: "pricing evidence"
        }
      };
    }
  };
}

{
  let bindingSeen = null;
  const result = await executeEvidencePlan({
    claim_contract: claim,
    pricing,
    providers: providersFor("203.0.113.10", (binding) => { bindingSeen = binding; }),
    validate_source_url: async () => ({
      ok: true,
      host: "docs.acme.example",
      addresses: ["203.0.113.10", "203.0.113.11"],
      dns_checked: true
    })
  });

  const fetchResult = result.action_results.find((item) => item.reservation?.kind === "SOURCE_FETCH");
  assert.equal(fetchResult.status, "COMPLETED");
  assert.deepEqual(bindingSeen, {
    validated_source_url: sourceUrl,
    host: "docs.acme.example",
    addresses: ["203.0.113.10", "203.0.113.11"],
    dns_checked: true
  });
  assert.equal(Object.isFrozen(bindingSeen), true);
  assert.equal(Object.isFrozen(bindingSeen.addresses), true);
}

{
  const result = await executeEvidencePlan({
    claim_contract: claim,
    pricing,
    providers: providersFor("127.0.0.1"),
    validate_source_url: async () => ({
      ok: true,
      host: "docs.acme.example",
      addresses: ["203.0.113.10"],
      dns_checked: true
    })
  });

  const fetchResult = result.action_results.find((item) => item.reservation?.kind === "SOURCE_FETCH");
  assert.equal(fetchResult.status, "FAILED");
  assert.match(fetchResult.error_code, /CONNECTED_ADDRESS_NOT_VALIDATED/);
  assert.equal(result.outcome.verdict, "UNKNOWN");
}

{
  const result = await executeEvidencePlan({
    claim_contract: claim,
    pricing,
    providers: providersFor(""),
    validate_source_url: async () => ({
      ok: true,
      host: "docs.acme.example",
      addresses: ["203.0.113.10"],
      dns_checked: true
    })
  });

  const fetchResult = result.action_results.find((item) => item.reservation?.kind === "SOURCE_FETCH");
  assert.equal(fetchResult.status, "FAILED");
  assert.match(fetchResult.error_code, /CONNECTED_ADDRESS_REQUIRED/);
  assert.equal(result.outcome.verdict, "UNKNOWN");
}

console.log("evidence fetch network binding regression: ok");
