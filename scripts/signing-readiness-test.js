import assert from "node:assert/strict";
import entry from "../src/entry.js";

async function generatePair() {
  const pair = await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]);
  return {
    private_jwk: await crypto.subtle.exportKey("jwk", pair.privateKey),
    public_jwk: await crypto.subtle.exportKey("jwk", pair.publicKey)
  };
}
async function getJson(path, env) {
  const response = await entry.fetch(new Request("https://proofttl.test" + path), env);
  return { response, body: await response.json() };
}
const active = await generatePair();
const unrelated = await generatePair();
const kid = "readiness-test-key";
const validEnv = {
  PROOFTTL_REQUIRE_SIGNED_LEASES: "true",
  PROOFTTL_SIGNING_KEYRING_JSON: JSON.stringify({
    active_kid: kid,
    keys: [{ kid, private_jwk: active.private_jwk }]
  })
};
const validKeys = await getJson("/.well-known/proofttl-keys.json", validEnv);
assert.equal(validKeys.response.status, 200);
assert.equal(validKeys.body.signing_enabled, true, "valid active private/public pair is advertised as enabled");
assert.equal(validKeys.body.active_kid, kid);
assert.equal(validKeys.body.keys.length, 1);
assert.equal(validKeys.body.keys[0].x, active.public_jwk.x, "published public key matches the active private key");
assert.equal("d" in validKeys.body.keys[0], false, "private signing scalar is never published");

const validDiscovery = await getJson("/.well-known/proofttl.json", validEnv);
assert.equal(validDiscovery.body.signing.enabled, true);
assert.equal(validDiscovery.body.capabilities.filter((value) => value === "ed25519_issuance_signatures").length, 1, "signature capability is advertised exactly once");

const mismatchedEnv = {
  PROOFTTL_REQUIRE_SIGNED_LEASES: "true",
  PROOFTTL_SIGNING_KEYRING_JSON: JSON.stringify({
    active_kid: kid,
    keys: [{ kid, private_jwk: active.private_jwk, public_jwk: { ...unrelated.public_jwk, kid } }]
  })
};
const mismatchedKeys = await getJson("/.well-known/proofttl-keys.json", mismatchedEnv);
assert.equal(mismatchedKeys.body.signing_enabled, false, "mismatched private/public pair fails closed");
assert.equal(mismatchedKeys.body.active_kid, null);
assert.equal(mismatchedKeys.body.keys.length, 0, "mismatched active key is not published as usable");
const mismatchedDiscovery = await getJson("/.well-known/proofttl.json", mismatchedEnv);
assert.equal(mismatchedDiscovery.body.signing.enabled, false);
assert.equal(mismatchedDiscovery.body.capabilities.includes("ed25519_issuance_signatures"), false, "invalid signing capability is not advertised");

const absent = await getJson("/.well-known/proofttl-keys.json", { PROOFTTL_REQUIRE_SIGNED_LEASES: "true" });
assert.equal(absent.body.signing_enabled, false, "missing signing key fails closed");
console.log("signing readiness: 14 checks passed");
