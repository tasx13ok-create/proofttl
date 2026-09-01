import {
  attachLeaseIssuanceSignature,
  attachLeaseVerificationContextSignature,
  buildLeaseIssuanceAttestation,
  buildLeaseVerificationContextAttestation,
  canonicalizeJson,
  publicSigningJwk,
  verifyLeaseIssuanceSignature,
  verifyLeaseVerificationContextSignature
} from "../src/lease-signing.js";

let passed = 0;

function assert(condition, message) {
  if (!condition) throw new Error(message);
  passed += 1;
  console.log(`PASS ${passed}: ${message}`);
}

function sampleLease() {
  return {
    lease_id: "ftl_test_signature_001",
    protocol: "ProofTTL/0.3.1",
    claim: "Example.com currently costs $20 per month.",
    status: "SUPPORTED",
    source_url: "https://example.com",
    final_url: "https://example.com/",
    evidence: "The current plan costs $20 per month.",
    reason: "semantic_support",
    issued_at: "2026-08-18T07:00:00.000Z",
    observed_at: "2026-08-18T07:00:00.000Z",
    expires_at: "2026-08-18T07:05:00.000Z",
    ttl_seconds: 300,
    source_fingerprint: "sha256:d003f90bc10db991b76e6fb480123cfce2cbb2b2784abe687fccccfa7ecacad8",
    last_source_fingerprint: "sha256:d003f90bc10db991b76e6fb480123cfce2cbb2b2784abe687fccccfa7ecacad8",
    confidence: 0.95,
    verifier: "proofttl-hybrid:qwen3-primary+llama70b-fallback",
    proof_basis: "SEMANTIC",
    lease_state: "ACTIVE",
    verification_count: 1,
    current_status: "SUPPORTED",
    claim_contract: {
      version: "proofttl-claim-contract-v1",
      original_claim: "Example.com currently costs $20 per month.",
      normalized_claim: "Example.com currently costs $20 per month",
      volatility: { level: "HIGH", reason: "COMMERCIAL_DYNAMIC" }
    },
    ttl_policy: {
      version: "proofttl-ttl-policy-v1",
      volatility: "HIGH",
      ttl_seconds: 17280,
      mode: "ADVISORY_V1",
      effective_ttl_seconds: 300,
      applied_to_lease: false
    },
    verification_outcome: {
      version: "proofttl-verification-outcome-v1",
      verdict: "SUPPORTED",
      evidence_verdict: "SUPPORTED",
      confidence: 0.91,
      evidence_confidence: 0.91,
      execution_status: "COMPLETE",
      confidence_status: "REPORTABLE",
      contradiction_pass: { required: true, completed: true },
      budget_denials: [],
      execution_failures: [],
      evidence_ledger: {
        version: "proofttl-evidence-ledger-v1",
        verdict: "SUPPORTED",
        confidence: 0.91,
        metrics: {
          support_strength: 0.95,
          contradiction_strength: 0,
          independent_support_groups: 1,
          independent_contradiction_groups: 0,
          accepted_count: 1,
          rejected_count: 0,
          ambiguous_count: 0
        },
        evidence_for: [{ source_url: "https://example.com/", stance: "FOR", quality_score: 0.95 }],
        evidence_against: [],
        ambiguous_evidence: [],
        rejected_evidence: []
      }
    }
  };
}

async function run() {
  console.log("ProofTTL lease signing tests\n");

  const pair = await crypto.subtle.generateKey(
    { name: "Ed25519" },
    true,
    ["sign", "verify"]
  );
  const privateJwk = await crypto.subtle.exportKey("jwk", pair.privateKey);
  const publicJwk = await crypto.subtle.exportKey("jwk", pair.publicKey);

  const lease = sampleLease();
  const attestation = buildLeaseIssuanceAttestation(lease);
  assert(attestation.issued_status === "SUPPORTED", "attestation preserves issued verdict");
  assert(!("lease_state" in attestation), "mutable lease_state is excluded from issuance attestation");
  assert(!("current_status" in attestation), "mutable current_status is excluded from issuance attestation");
  assert(!("claim_contract" in attestation), "v1 issuance attestation remains byte-compatible with existing clients");

  const context = buildLeaseVerificationContextAttestation(lease);
  assert(context.claim_contract.version === "proofttl-claim-contract-v1", "context attestation binds Claim Contract");
  assert(context.ttl_policy.mode === "ADVISORY_V1", "context attestation binds TTL rationale");
  assert(context.verification_outcome.version === "proofttl-verification-outcome-v1", "context attestation binds final verification outcome");
  assert(context.verification_outcome.evidence_ledger.version === "proofttl-evidence-ledger-v1", "context attestation binds FOR/AGAINST evidence ledger");
  assert(context.verification_outcome.contradiction_pass.completed === true, "context attestation binds contradiction-pass completion");

  const canonicalA = canonicalizeJson({ z: 1, a: { y: 2, x: 3 } });
  const canonicalB = canonicalizeJson({ a: { x: 3, y: 2 }, z: 1 });
  assert(canonicalA === canonicalB, "canonical JSON is independent of object insertion order");

  await attachLeaseIssuanceSignature(
    lease,
    privateJwk,
    "proofttl-test-key",
    "2026-08-18T07:00:01.000Z"
  );
  await attachLeaseVerificationContextSignature(
    lease,
    privateJwk,
    "proofttl-test-key",
    "2026-08-18T07:00:01.000Z"
  );
  assert(lease.signature?.algorithm === "Ed25519", "lease receives Ed25519 signature metadata");
  assert(lease.signature?.key_id === "proofttl-test-key", "signature records key ID");
  assert(Boolean(lease.signature?.value), "signature contains base64url value");
  assert(Boolean(lease.verification_context_signature?.value), "verification context receives separate signature");
  assert(await verifyLeaseIssuanceSignature(lease, publicJwk), "fresh lease signature verifies with public key");
  assert(await verifyLeaseVerificationContextSignature(lease, publicJwk), "full verification context verifies with public key");

  lease.lease_state = "REVOKED";
  lease.current_status = "UNKNOWN";
  lease.verification_count = 4;
  lease.last_checked_at = "2026-08-18T07:02:00.000Z";
  assert(await verifyLeaseIssuanceSignature(lease, publicJwk), "monitoring state changes do not invalidate issuance signature");
  assert(await verifyLeaseVerificationContextSignature(lease, publicJwk), "monitoring state changes do not invalidate verification-context signature");

  const tamperedClaim = structuredClone(lease);
  tamperedClaim.claim = "Example.com is a production payments domain.";
  assert(!(await verifyLeaseIssuanceSignature(tamperedClaim, publicJwk)), "tampering with signed claim invalidates signature");

  const tamperedFingerprint = structuredClone(lease);
  tamperedFingerprint.source_fingerprint = "sha256:deadbeef";
  assert(!(await verifyLeaseIssuanceSignature(tamperedFingerprint, publicJwk)), "tampering with source fingerprint invalidates signature");
  assert(!(await verifyLeaseVerificationContextSignature(tamperedFingerprint, publicJwk)), "tampering with context-bound source fingerprint invalidates context signature");

  const tamperedContext = structuredClone(lease);
  tamperedContext.ttl_policy.effective_ttl_seconds = 999999;
  assert(!(await verifyLeaseVerificationContextSignature(tamperedContext, publicJwk)), "tampering with TTL rationale invalidates context signature");

  const tamperedLedger = structuredClone(lease);
  tamperedLedger.verification_outcome.evidence_ledger.verdict = "UNKNOWN";
  assert(!(await verifyLeaseVerificationContextSignature(tamperedLedger, publicJwk)), "tampering with evidence ledger invalidates context signature");

  const tamperedExecution = structuredClone(lease);
  tamperedExecution.verification_outcome.budget_denials.push({ code: "CALL_LIMIT", kind: "semantic", idempotency_key: "late-edit" });
  assert(!(await verifyLeaseVerificationContextSignature(tamperedExecution, publicJwk)), "tampering with execution denials invalidates context signature");

  const malformedOutcome = structuredClone(lease);
  malformedOutcome.verification_outcome = { version: "wrong" };
  assert(!(await verifyLeaseVerificationContextSignature(malformedOutcome, publicJwk)), "malformed verification outcome fails closed during context verification");

  const advertised = publicSigningJwk(privateJwk, "proofttl-test-key");
  assert(advertised.kty === "OKP" && advertised.crv === "Ed25519", "public discovery key is Ed25519 OKP");
  assert(advertised.x === publicJwk.x, "public discovery key matches generated public key");
  assert(!("d" in advertised), "public discovery key never exposes private scalar");

  console.log(`\nSUCCESS: ${passed} lease-signing checks passed.`);
}

run().catch((error) => {
  console.error("\nLEASE SIGNING TEST FAILED:", error.stack || error.message);
  process.exitCode = 1;
});
