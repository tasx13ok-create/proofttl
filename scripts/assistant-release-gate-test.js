import assert from "node:assert/strict";
import { attachLeaseIssuanceSignature, verifyLeaseAgainstTrustedJwks } from "../src/lease-signing.js";
import { gateAssistantDraft } from "../src/assistant-release-gate.js";

const pair = await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]);
const privateJwk = await crypto.subtle.exportKey("jwk", pair.privateKey);
const publicJwk = await crypto.subtle.exportKey("jwk", pair.publicKey);
const env = {
  PROOFTTL_SIGNING_PRIVATE_JWK: JSON.stringify(privateJwk),
  PROOFTTL_SIGNING_KEY_ID: "release-gate-test-key"
};
const now = Date.parse("2026-10-09T12:00:00.000Z");
const lease = {
  lease_id: "ftl_0123456789abcdef",
  protocol: "ProofTTL/0.3.1",
  claim: "The service launched in 2024.",
  status: "SUPPORTED",
  issued_status: "SUPPORTED",
  source_url: "https://example.com/launch",
  final_url: "https://example.com/launch",
  evidence: "The service launched in 2024.",
  reason: "Direct evidence match",
  issued_at: "2026-10-09T11:00:00.000Z",
  expires_at: "2026-10-09T13:00:00.000Z",
  ttl_seconds: 7200,
  source_fingerprint: "sha256:0123456789abcdef",
  confidence: 0.99,
  verifier: "deterministic-exact-match",
  proof_basis: "EXACT_TEXT",
  lease_state: "ACTIVE"
};
await attachLeaseIssuanceSignature(lease, privateJwk, "release-gate-test-key", lease.issued_at);
const trusted = { keys: [{ ...publicJwk, kid: "release-gate-test-key" }] };
assert.equal(await verifyLeaseAgainstTrustedJwks(lease, trusted), true, "trusted public key validates signed lease");
assert.equal(await verifyLeaseAgainstTrustedJwks(lease, { keys: [{ ...publicJwk, kid: "wrong-key" }] }), false, "unknown key ID is rejected");
assert.equal(await verifyLeaseAgainstTrustedJwks(lease, trusted, ["release-gate-test-key"]), false, "revoked key ID is rejected");

const allowed = await gateAssistantDraft({ draft: lease.claim, lease, env, now });
assert.equal(allowed.decision, "ALLOW", "exact single claim backed by trusted active signed lease is releasable");
assert.equal(allowed.response, lease.claim);
for (const [draft, reason] of [
  ["The service launched in 2024. It was the first in the country.", "draft_inventory_not_provably_complete"],
  ["The service launched in 2024 and quickly expanded.", "draft_inventory_not_provably_complete"],
  ["The service launched in 2024, then revenue doubled.", "draft_inventory_not_provably_complete"],
  ["The service launched in 2025.", "draft_contains_unverified_or_unbound_claims"]
]) {
  const blocked = await gateAssistantDraft({ draft, lease, env, now });
  assert.equal(blocked.decision, "BLOCKED");
  assert.equal(blocked.response, null);
  assert.equal(blocked.reason, reason);
}
assert.equal((await gateAssistantDraft({ draft: lease.claim, lease: null, env, now })).reason, "grounded_lease_required");
const tampered = { ...lease, claim: "The service launched in 2025." };
assert.equal((await gateAssistantDraft({ draft: tampered.claim, lease: tampered, env, now })).reason, "lease_signature_not_trusted");
const expired = { ...lease, expires_at: "2026-10-09T11:59:59.000Z" };
assert.equal((await gateAssistantDraft({ draft: lease.claim, lease: expired, env, now })).reason, "lease_signature_not_trusted", "tampering with attested expiry invalidates signature");
const inactive = { ...lease, lease_state: "REVOKED" };
assert.equal((await gateAssistantDraft({ draft: lease.claim, lease: inactive, env, now })).reason, "lease_not_active", "inactive leases are rejected");
const noKeys = await gateAssistantDraft({ draft: lease.claim, lease, env: {}, now });
assert.equal(noKeys.decision, "BLOCKED");
assert.equal(noKeys.reason, "trusted_signing_keys_unavailable");
console.log("assistant release gate: 12 checks passed");
