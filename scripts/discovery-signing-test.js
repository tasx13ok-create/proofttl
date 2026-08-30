import assert from "node:assert/strict";
import worker from "../src/entry.js";
import {
  LEASE_ATTESTATION_VERSION,
  LEASE_SIGNATURE_VERSION,
  VERIFICATION_CONTEXT_ATTESTATION_VERSION,
  VERIFICATION_CONTEXT_SIGNATURE_VERSION
} from "../src/lease-signing.js";

let checks = 0;
async function check(name, fn) {
  await fn();
  checks += 1;
  console.log(`ok ${checks} - ${name}`);
}

async function readJson(path, env = {}) {
  const response = await worker.fetch(
    new Request(`https://example.test${path}`, { method: "GET" }),
    env,
    { waitUntil() {} }
  );
  assert.equal(response.status, 200);
  return response.json();
}

await check("unsigned discovery does not advertise signing capabilities it cannot perform", async () => {
  const discovery = await readJson("/.well-known/proofttl.json");
  assert.equal(discovery.signing.enabled, false);
  assert.equal(discovery.signing.algorithm, null);
  assert.equal(discovery.capabilities.includes("ed25519_issuance_signatures"), false);
  assert.equal(discovery.capabilities.includes("signed_verification_context"), false);
  assert.equal(discovery.capabilities.includes("signed_monitoring_event_chain"), false);
  assert.equal(discovery.capabilities.includes("deterministic_claim_decomposition"), true);
  assert.equal(discovery.endpoints.claims_decompose.verdicts_issued, false);
});

const pair = await crypto.subtle.generateKey(
  { name: "Ed25519" },
  true,
  ["sign", "verify"]
);
const privateJwk = await crypto.subtle.exportKey("jwk", pair.privateKey);
const env = {
  PROOFTTL_SIGNING_PRIVATE_JWK: JSON.stringify(privateJwk),
  PROOFTTL_SIGNING_KEY_ID: "proofttl-discovery-test"
};

await check("signed discovery advertises both stable issuance and verification-context versions", async () => {
  const discovery = await readJson("/.well-known/proofttl.json", env);
  assert.equal(discovery.signing.enabled, true);
  assert.equal(discovery.signing.algorithm, "Ed25519");
  assert.equal(discovery.signing.issuance.signature_version, LEASE_SIGNATURE_VERSION);
  assert.equal(discovery.signing.issuance.attestation_version, LEASE_ATTESTATION_VERSION);
  assert.equal(
    discovery.signing.verification_context.signature_version,
    VERIFICATION_CONTEXT_SIGNATURE_VERSION
  );
  assert.equal(
    discovery.signing.verification_context.attestation_version,
    VERIFICATION_CONTEXT_ATTESTATION_VERSION
  );
  assert.equal(discovery.signing.verification_context.ttl_policy_mode, "ADVISORY_V1");
  assert.equal(discovery.capabilities.includes("ed25519_issuance_signatures"), true);
  assert.equal(discovery.capabilities.includes("signed_verification_context"), true);
});

await check("public key document exposes versioned contexts but never the private scalar", async () => {
  const keys = await readJson("/.well-known/proofttl-keys.json", env);
  assert.equal(keys.signing_enabled, true);
  assert.equal(keys.signature_version, LEASE_SIGNATURE_VERSION);
  assert.equal(keys.attestation_version, LEASE_ATTESTATION_VERSION);
  assert.equal(keys.verification_context_signature_version, VERIFICATION_CONTEXT_SIGNATURE_VERSION);
  assert.equal(keys.verification_context_attestation_version, VERIFICATION_CONTEXT_ATTESTATION_VERSION);
  assert.equal(keys.keys.length, 1);
  assert.equal(keys.keys[0].kid, "proofttl-discovery-test");
  assert.equal("d" in keys.keys[0], false);
});

await check("OpenAPI exposes decomposition as non-verdict deterministic preflight", async () => {
  const openapi = await readJson("/openapi.json", env);
  const operation = openapi.paths?.["/claims/decompose"]?.post;
  assert.ok(operation);
  assert.match(operation.description, /no source retrieval or model inference/i);
  assert.match(operation.description, /issues no SUPPORTED, CONTRADICTED, or UNKNOWN verdict/i);
});

console.log(`SUCCESS: ${checks} discovery/signing checks passed.`);
