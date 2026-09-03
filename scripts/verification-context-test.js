import assert from "node:assert/strict";
import { attachImmutableVerificationContext } from "../src/lease-store.js";

let checks = 0;
function check(name, fn) {
  fn();
  checks += 1;
  console.log(`ok ${checks} - ${name}`);
}

function baseLease(overrides = {}) {
  return {
    lease_id: "ftl_test123",
    protocol: "ProofTTL/0.3.1",
    claim: "Acme was founded in 2018",
    status: "SUPPORTED",
    source_url: "https://example.com/about",
    final_url: "https://example.com/about",
    evidence: "Acme was founded in 2018",
    reason: "exact_claim_text_found_in_source",
    issued_at: "2026-09-02T12:00:00.000Z",
    observed_at: "2026-09-02T12:00:00.000Z",
    expires_at: "2026-09-02T13:00:00.000Z",
    ttl_seconds: 3600,
    source_fingerprint: "sha256:abc123",
    confidence: 0.99,
    verifier: "deterministic-exact-match",
    proof_basis: "EXACT_TEXT",
    lease_state: "ACTIVE",
    ...overrides
  };
}

check("ordinary single-source claim gets a structured signed-context outcome candidate", () => {
  const lease = baseLease();
  attachImmutableVerificationContext(lease);

  assert.equal(lease.claim_contract.version, "proofttl-claim-contract-v1");
  assert.equal(lease.verification_outcome.version, "proofttl-verification-outcome-v1");
  assert.equal(lease.verification_outcome.evidence_ledger.version, "proofttl-evidence-ledger-v1");
  assert.equal(lease.verification_outcome.source_verdict.status, "SUPPORTED");
  assert.equal(lease.verification_outcome.input_source.provenance, "CALLER_PROVIDED_SOURCE");
  assert.equal(lease.ttl_policy.mode, "ADVISORY_V1");
  assert.equal(lease.status, lease.verification_outcome.verdict);
  assert.equal(lease.issued_status, lease.verification_outcome.verdict);
  assert.equal(lease.current_status, lease.verification_outcome.verdict);
});

check("high-assurance claim fails closed until contradiction pass actually runs", () => {
  const lease = baseLease({
    claim: "Acme is SOC 2 certified and costs $99 per month",
    evidence: "Acme is SOC 2 certified and costs $99 per month",
    source_fingerprint: "sha256:def456"
  });

  attachImmutableVerificationContext(lease);

  assert.equal(lease.verification_outcome.triage.verification_depth, "HIGH_ASSURANCE");
  assert.equal(lease.verification_outcome.contradiction_pass.required, true);
  assert.equal(lease.verification_outcome.contradiction_pass.completed, false);
  assert.equal(lease.verification_outcome.verdict, "UNKNOWN");
  assert.equal(lease.verification_outcome.execution_status, "CONTRADICTION_PASS_INCOMPLETE");
  assert.equal(lease.verification_outcome.confidence, null);
  assert.equal(lease.source_verdict.status, "SUPPORTED");
  assert.equal(lease.status, "UNKNOWN");
  assert.equal(lease.issued_status, "UNKNOWN");
  assert.equal(lease.current_status, "UNKNOWN");
  assert.equal(lease.confidence, 0);
  assert.equal(lease.proof_basis, "EVIDENCE_LEDGER");
});

check("pre-existing response status aliases cannot preserve a stale one-source verdict", () => {
  const lease = baseLease({
    claim: "Acme is SOC 2 certified and costs $99 per month",
    evidence: "Acme is SOC 2 certified and costs $99 per month",
    source_fingerprint: "sha256:aliasguard",
    issued_status: "SUPPORTED",
    current_status: "SUPPORTED"
  });

  attachImmutableVerificationContext(lease);

  assert.equal(lease.source_verdict.status, "SUPPORTED");
  assert.equal(lease.verification_outcome.verdict, "UNKNOWN");
  assert.equal(lease.status, "UNKNOWN");
  assert.equal(lease.issued_status, "UNKNOWN");
  assert.equal(lease.current_status, "UNKNOWN");
});

check("context enrichment is idempotent and does not rewrite the original source verdict", () => {
  const lease = baseLease({
    claim: "Acme is SOC 2 certified and costs $99 per month",
    evidence: "Acme is SOC 2 certified and costs $99 per month",
    source_fingerprint: "sha256:ghi789"
  });

  attachImmutableVerificationContext(lease);
  const first = JSON.stringify(lease.verification_outcome);
  const issued = lease.issued_status;
  const current = lease.current_status;
  attachImmutableVerificationContext(lease);

  assert.equal(JSON.stringify(lease.verification_outcome), first);
  assert.equal(lease.source_verdict.status, "SUPPORTED");
  assert.equal(lease.issued_status, issued);
  assert.equal(lease.current_status, current);
});

console.log(`SUCCESS: ${checks} verification-context integration checks passed.`);
