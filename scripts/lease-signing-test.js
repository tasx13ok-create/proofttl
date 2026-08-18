import {
  attachLeaseIssuanceSignature,
  buildLeaseIssuanceAttestation,
  canonicalizeJson,
  publicSigningJwk,
  verifyLeaseIssuanceSignature
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
    claim: "Example.com is intended for illustrative examples in documents.",
    status: "SUPPORTED",
    source_url: "https://example.com",
    final_url: "https://example.com/",
    evidence: "This domain is for use in illustrative examples in documents.",
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
    current_status: "SUPPORTED"
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

  const canonicalA = canonicalizeJson({ z: 1, a: { y: 2, x: 3 } });
  const canonicalB = canonicalizeJson({ a: { x: 3, y: 2 }, z: 1 });
  assert(canonicalA === canonicalB, "canonical JSON is independent of object insertion order");

  await attachLeaseIssuanceSignature(
    lease,
    privateJwk,
    "proofttl-test-key",
    "2026-08-18T07:00:01.000Z"
  );
  assert(lease.signature?.algorithm === "Ed25519", "lease receives Ed25519 signature metadata");
  assert(lease.signature?.key_id === "proofttl-test-key", "signature records key ID");
  assert(Boolean(lease.signature?.value), "signature contains base64url value");
  assert(
    await verifyLeaseIssuanceSignature(lease, publicJwk),
    "fresh lease signature verifies with public key"
  );

  lease.lease_state = "REVOKED";
  lease.current_status = "UNKNOWN";
  lease.verification_count = 4;
  lease.last_checked_at = "2026-08-18T07:02:00.000Z";
  assert(
    await verifyLeaseIssuanceSignature(lease, publicJwk),
    "monitoring state changes do not invalidate issuance signature"
  );

  const tamperedClaim = structuredClone(lease);
  tamperedClaim.claim = "Example.com is a production payments domain.";
  assert(
    !(await verifyLeaseIssuanceSignature(tamperedClaim, publicJwk)),
    "tampering with signed claim invalidates signature"
  );

  const tamperedFingerprint = structuredClone(lease);
  tamperedFingerprint.source_fingerprint = "sha256:deadbeef";
  assert(
    !(await verifyLeaseIssuanceSignature(tamperedFingerprint, publicJwk)),
    "tampering with source fingerprint invalidates signature"
  );

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
