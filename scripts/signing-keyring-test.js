import assert from "node:assert/strict";
import { publicSigningKeySet, signingConfigFromEnv, parseSigningKeyring } from "../src/signing-keyring.js";
import { attachLeaseIssuanceSignature, verifyLeaseAgainstTrustedJwks } from "../src/lease-signing.js";

async function pair() {
  const value = await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]);
  return {
    private_jwk: await crypto.subtle.exportKey("jwk", value.privateKey),
    public_jwk: await crypto.subtle.exportKey("jwk", value.publicKey)
  };
}
const old = await pair();
const active = await pair();
const revoked = await pair();
const env = {
  PROOFTTL_SIGNING_KEYRING_JSON: JSON.stringify({
    active_kid: "key-2026-b",
    keys: [
      { kid: "key-2026-a", public_jwk: { ...old.public_jwk, kid: "key-2026-a" } },
      { kid: "key-2026-b", private_jwk: active.private_jwk },
      { kid: "key-compromised", public_jwk: { ...revoked.public_jwk, kid: "key-compromised" }, revoked: true }
    ]
  })
};
const config = signingConfigFromEnv(env);
assert.equal(config.active_kid, "key-2026-b");
assert.equal(config.public_keys.length, 2, "current and previous trusted keys remain published during rotation");
assert.deepEqual(config.revoked_kids, ["key-compromised"]);
const publicSet = publicSigningKeySet(env);
assert.equal(publicSet.active_kid, "key-2026-b");
assert.equal(publicSet.keys.some((key) => key.kid === "key-compromised"), false, "revoked key is removed from JWKS");
assert.equal(publicSet.keys.some((key) => key.kid === "key-2026-a"), true, "previous key remains trusted until intentionally retired");

const lease = {
  lease_id: "ftl_0123456789abcdef",
  protocol: "ProofTTL/0.3.1",
  claim: "Rotation keeps previous signatures verifiable.",
  status: "SUPPORTED",
  issued_status: "SUPPORTED",
  source_url: "https://example.com/rotation",
  final_url: "https://example.com/rotation",
  evidence: "Rotation keeps previous signatures verifiable.",
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
await attachLeaseIssuanceSignature(lease, old.private_jwk, "key-2026-a", lease.issued_at);
assert.equal(await verifyLeaseAgainstTrustedJwks(lease, publicSet), true, "previous key verifies during overlap rotation");
assert.equal(await verifyLeaseAgainstTrustedJwks(lease, publicSet, config.revoked_kids), true);
assert.equal(await verifyLeaseAgainstTrustedJwks(lease, publicSet, ["key-2026-a"]), false, "consumer-side revocation overrides a published key");
assert.throws(() => parseSigningKeyring({ active_kid: "missing", keys: [] }), /active_signing_key_unavailable/);
assert.throws(() => parseSigningKeyring({ active_kid: "key-2026-b", keys: [{ kid: "key-2026-b", private_jwk: active.private_jwk }, { kid: "key-2026-b", private_jwk: active.private_jwk }] }), /duplicated/);
console.log("signing keyring rotation/revocation: 9 checks passed");
