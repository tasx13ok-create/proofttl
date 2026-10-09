import { evaluateVerificationGate } from "../src/verification-gateway.js";

let passed = 0;
function assert(condition, message) {
  if (!condition) throw new Error(message);
  passed += 1;
  console.log(`PASS ${passed}: ${message}`);
}

const now = Date.parse("2026-10-09T12:00:00.000Z");
const draft = "The service launched in 2024.";
const claim = {
  id: "claim-1",
  text: "The service launched in 2024.",
  source_url: "https://example.com/launch",
  risk: "high"
};
const supported = {
  lease_id: "ftl_test_123",
  status: "SUPPORTED",
  issued_status: "SUPPORTED",
  current_status: "SUPPORTED",
  lease_state: "ACTIVE",
  expires_at: "2026-10-10T12:00:00.000Z",
  final_url: "https://example.com/launch",
  evidence: "The service launched in 2024.",
  signature_verified: true
};
const verifySupported = async () => ({ ...supported });

async function run() {
  const allow = await evaluateVerificationGate({
    draft, claims: [claim], inventoryComplete: true,
    verifyClaim: verifySupported, now
  });
  assert(allow.decision === "ALLOW", "all supported active signed claims allow release");
  assert(allow.response === draft, "allowed result returns the original draft");
  assert(allow.claims_checked === 1, "allowed result reports checked claim count");

  const unknown = await evaluateVerificationGate({
    draft, claims: [claim], inventoryComplete: true,
    verifyClaim: async () => ({ ...supported, status: "UNKNOWN", current_status: "UNKNOWN" }), now
  });
  assert(unknown.decision === "BLOCKED" && unknown.response === null, "UNKNOWN blocks release");
  assert(unknown.claims[0].verdict === "UNKNOWN", "UNKNOWN is preserved");

  const contradicted = await evaluateVerificationGate({
    draft, claims: [claim], inventoryComplete: true,
    verifyClaim: async () => ({ ...supported, status: "CONTRADICTED", current_status: "CONTRADICTED" }), now
  });
  assert(contradicted.decision === "BLOCKED", "CONTRADICTED blocks release");

  const expired = await evaluateVerificationGate({
    draft, claims: [claim], inventoryComplete: true,
    verifyClaim: async () => ({ ...supported, expires_at: "2026-10-09T11:59:59.000Z" }), now
  });
  assert(expired.decision === "BLOCKED" && expired.claims[0].reason === "lease_expired_or_missing_expiry", "expired leases block release");

  const unsigned = await evaluateVerificationGate({
    draft, claims: [claim], inventoryComplete: true,
    verifyClaim: async () => ({ ...supported, signature_verified: false }), now
  });
  assert(unsigned.decision === "BLOCKED" && unsigned.claims[0].reason === "signed_lease_not_verified", "unsigned or unvalidated leases block by default");

  const incomplete = await evaluateVerificationGate({
    draft, claims: [claim], inventoryComplete: false,
    verifyClaim: verifySupported, now
  });
  assert(incomplete.decision === "BLOCKED" && incomplete.reason === "claim_inventory_not_confirmed_complete", "incomplete claim inventory blocks release");
  assert(incomplete.claims_checked === 0, "incomplete inventory does not spend verification calls");

  const empty = await evaluateVerificationGate({
    draft, claims: [], inventoryComplete: true, verifyClaim: verifySupported, now
  });
  assert(empty.decision === "BLOCKED" && empty.reason === "claim_inventory_empty", "empty inventory cannot bypass the gate");

  const notInDraft = await evaluateVerificationGate({
    draft, claims: [{ ...claim, text: "This claim does not appear in the draft." }],
    inventoryComplete: true, verifyClaim: verifySupported, now
  });
  assert(notInDraft.decision === "BLOCKED" && notInDraft.reason === "claim_not_bound_to_draft", "claims must bind to exact draft text");

  const duplicate = await evaluateVerificationGate({
    draft, claims: [claim, claim], inventoryComplete: true, verifyClaim: verifySupported, now
  });
  assert(duplicate.decision === "BLOCKED" && duplicate.reason === "claim_ids_missing_or_duplicated", "duplicate claim identifiers block release");

  const badSource = await evaluateVerificationGate({
    draft, claims: [{ ...claim, source_url: "http://user:pass@example.com/path" }],
    inventoryComplete: true, verifyClaim: verifySupported, now
  });
  assert(badSource.decision === "BLOCKED" && badSource.reason === "claim_source_url_invalid", "source URLs with embedded credentials are rejected");

  const thrown = await evaluateVerificationGate({
    draft, claims: [claim], inventoryComplete: true,
    verifyClaim: async () => { const error = new Error("private internal detail"); error.code = "upstream_timeout"; throw error; }, now
  });
  assert(thrown.decision === "BLOCKED" && thrown.claims[0].reason === "upstream_timeout", "verifier failures fail closed with sanitized error codes");

  const missingVerifier = await evaluateVerificationGate({
    draft, claims: [claim], inventoryComplete: true, now
  });
  assert(missingVerifier.decision === "BLOCKED" && missingVerifier.reason === "verifier_not_configured", "missing verifier fails closed");

  const tooMany = await evaluateVerificationGate({
    draft, claims: Array.from({ length: 3 }, (_, i) => ({ ...claim, id: `c${i}` })),
    inventoryComplete: true, verifyClaim: verifySupported, now, policy: { maxClaims: 2 }
  });
  assert(tooMany.decision === "BLOCKED" && tooMany.reason === "claim_limit_exceeded", "claim cap prevents unbounded verification work");

  const noEvidence = await evaluateVerificationGate({
    draft, claims: [claim], inventoryComplete: true,
    verifyClaim: async () => ({ ...supported, evidence: "" }), now
  });
  assert(noEvidence.decision === "BLOCKED" && noEvidence.claims[0].reason === "evidence_missing", "missing evidence blocks release");

  console.log(`PASS: ${passed} verification-gateway assertions`);
}

run().catch(error => {
  console.error("VERIFICATION GATEWAY TEST FAILED:", error.message || error);
  process.exitCode = 1;
});
