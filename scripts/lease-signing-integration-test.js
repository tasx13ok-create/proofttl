import core from "../src/index.js";
import entry from "../src/entry.js";
import { verifyLeaseIssuanceSignature } from "../src/lease-signing.js";

let passed = 0;
function assert(condition, message) {
  if (!condition) throw new Error(message);
  passed += 1;
  console.log(`PASS ${passed}: ${message}`);
}
class MemoryKV {
  constructor() { this.entries = new Map(); }
  async get(key) { return this.entries.get(key)?.value ?? null; }
  async put(key, value, options = {}) {
    this.entries.set(key, { value: String(value), metadata: options.metadata ?? null });
  }
  async list({ prefix = "", limit = 1000 } = {}) {
    return { keys: [...this.entries.entries()].filter(([key]) => key.startsWith(prefix)).slice(0, limit).map(([name, value]) => ({ name, metadata: value.metadata })), list_complete: true };
  }
}
async function run() {
  console.log("ProofTTL signed issuance integration test\n");
  const pair = await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]);
  const privateJwk = await crypto.subtle.exportKey("jwk", pair.privateKey);
  const publicJwk = await crypto.subtle.exportKey("jwk", pair.publicKey);
  const kv = new MemoryKV();
  const env = {
    LEASES: kv,
    PROOFTTL_REQUIRE_SIGNED_LEASES: "true",
    PROOFTTL_SIGNING_PRIVATE_JWK: JSON.stringify(privateJwk),
    PROOFTTL_SIGNING_KEY_ID: "integration-test-key"
  };
  const originalFetch = globalThis.fetch;
  let sourceFetches = 0;
  globalThis.fetch = async () => { sourceFetches += 1; return new Response("The test release version is 4.2.0 and is publicly documented.", {
    status: 200,
    headers: { "content-type": "text/plain; charset=utf-8" }
  }); };
  try {
    const response = await core.fetch(new Request("https://proofttl.test/verify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        claim: "The test release version is 4.2.0",
        source_url: "https://8.8.8.8/source",
        ttl_seconds: 300
      })
    }), env);
    const lease = await response.json();
    assert(response.status === 200, "verification issues a lease when required signing is configured");
    assert(lease.signature?.algorithm === "Ed25519", "issuance path attaches Ed25519 signature");
    assert(lease.signature?.key_id === "integration-test-key", "issuance uses configured stable key ID");
    assert(await verifyLeaseIssuanceSignature(lease, publicJwk), "issued lease signature verifies against trusted public key");
    const keysResponse = await core.fetch(new Request("https://proofttl.test/.well-known/proofttl-keys.json"), env);
    const keySet = await keysResponse.json();
    assert(keysResponse.status === 200 && keySet.keys?.length === 1, "public JWKS endpoint publishes one key");
    assert(keySet.keys[0].kid === "integration-test-key" && keySet.keys[0].x === publicJwk.x, "published key ID and public material match issuer");
    assert(!("d" in keySet.keys[0]), "public JWKS never exposes private signing scalar");
    const noKey = await core.fetch(new Request("https://proofttl.test/verify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ claim: "A claim", source_url: "https://8.8.8.8/source" })
    }), { LEASES: new MemoryKV(), PROOFTTL_REQUIRE_SIGNED_LEASES: "true" });
    assert(noKey.status === 503, "required signing fails closed before source fetch when key is absent");
    assert(sourceFetches === 1, "missing signing key does not trigger another source fetch");
    const noPublishedKey = await core.fetch(new Request("https://proofttl.test/.well-known/proofttl-jwks.json"), {});
    assert(noPublishedKey.status === 503, "JWKS discovery fails closed when no signing key is configured");
    const malformedKey = await core.fetch(new Request("https://proofttl.test/verify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ claim: "A claim", source_url: "https://8.8.8.8/source" })
    }), {
      LEASES: new MemoryKV(),
      PROOFTTL_REQUIRE_SIGNED_LEASES: "true",
      PROOFTTL_SIGNING_PRIVATE_JWK: JSON.stringify({ kty: "OKP", crv: "Ed25519", x: "bad", d: "bad" })
    });
    assert(malformedKey.status === 503, "malformed cryptographic key is rejected before source fetch");
    assert(sourceFetches === 1, "malformed signing key does not trigger a source fetch");

    const legacy = { ...lease, lease_id: "ftl_legacy0123456789abcdef" };
    delete legacy.signature;
    delete legacy.issued_attestation;
    await kv.put("lease:" + legacy.lease_id, JSON.stringify(legacy));
    const legacyRead = await entry.fetch(new Request("https://proofttl.test/lease/" + legacy.lease_id), env);
    const legacyReadBody = await legacyRead.json();
    assert(legacyRead.status === 200, "legacy lease remains readable for compatibility");
    assert(!legacyReadBody.signature && !legacyReadBody.issued_attestation, "reading an unsigned legacy lease never manufactures an issuance signature");
  } finally {
    globalThis.fetch = originalFetch;
  }
  console.log(`\nSUCCESS: ${passed} signed issuance integration checks passed.`);
}
run().catch((error) => {
  console.error("\nSIGNED ISSUANCE INTEGRATION FAILED:", error.stack || error.message);
  process.exitCode = 1;
});
