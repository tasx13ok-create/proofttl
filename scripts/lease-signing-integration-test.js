import core from "../src/index.js";
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
    PROOFTTL_LEASE_SIGNING_PRIVATE_JWK: JSON.stringify(privateJwk),
    PROOFTTL_LEASE_SIGNING_KEY_ID: "integration-test-key"
  };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response("The test release version is 4.2.0 and is publicly documented.", {
    status: 200,
    headers: { "content-type": "text/plain; charset=utf-8" }
  });
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
    const keysResponse = await core.fetch(new Request("https://proofttl.test/.well-known/proofttl-jwks.json"), env);
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
  } finally {
    globalThis.fetch = originalFetch;
  }
  console.log(`\nSUCCESS: ${passed} signed issuance integration checks passed.`);
}
run().catch((error) => {
  console.error("\nSIGNED ISSUANCE INTEGRATION FAILED:", error.stack || error.message);
  process.exitCode = 1;
});
