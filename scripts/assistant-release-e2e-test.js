import assert from "node:assert/strict";
import worker from "../src/worker.js";
import { attachLeaseIssuanceSignature } from "../src/lease-signing.js";

class MemoryKV {
  constructor(entries = []) { this.data = new Map(entries); }
  async get(key) { return this.data.get(key) ?? null; }
  async put(key, value) { this.data.set(key, typeof value === "string" ? value : JSON.stringify(value)); }
  async list({ prefix = "", limit = 1000 } = {}) {
    return { keys: [...this.data.keys()].filter((key) => key.startsWith(prefix)).slice(0, limit).map((name) => ({ name })), list_complete: true };
  }
}
const pair = await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]);
const privateJwk = await crypto.subtle.exportKey("jwk", pair.privateKey);
const claim = "The service launched in 2024.";
const lease = {
  lease_id: "ftl_0123456789abcdef",
  protocol: "ProofTTL/0.3.1",
  claim,
  status: "SUPPORTED",
  issued_status: "SUPPORTED",
  source_url: "https://example.com/launch",
  final_url: "https://example.com/launch",
  evidence: claim,
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
await attachLeaseIssuanceSignature(lease, privateJwk, "e2e-key", lease.issued_at);
const kv = new MemoryKV([["lease:" + lease.lease_id, JSON.stringify(lease)]]);
const env = {
  LEASES: kv,
  PROOFTTL_SIGNING_PRIVATE_JWK: JSON.stringify(privateJwk),
  PROOFTTL_SIGNING_KEY_ID: "e2e-key",
  PROOFTTL_ASSISTANT_FREE_DAILY_MESSAGES: "20",
  BETTER_AUTH_SECRET: "test-only-secret",
  ASSISTANT_RATE_LIMITER: { async limit() { return { success: true }; } },
  AI: {
    async run(model, options) {
      const last = options?.messages?.at(-1)?.content || "";
      if (/SECRET_UNGROUNDED_DRAFT/.test(last)) return { response: "SECRET_UNGROUNDED_DRAFT contains an unverified factual claim." };
      if (/Fact Lease ftl_0123456789abcdef/i.test(last)) return { response: claim };
      return { response: "SECRET_UNGROUNDED_DRAFT contains an unverified factual claim." };
    }
  }
};
const ctx = { waitUntil(promise) { Promise.resolve(promise).catch(() => {}); } };
const grounded = await worker.fetch(new Request("https://proofttl.test/assistant/text", {
  method: "POST",
  headers: { "content-type": "application/json", "cf-connecting-ip": "203.0.113.91" },
  body: JSON.stringify({ message: "What is the claim in Fact Lease " + lease.lease_id + "?" })
}), env, ctx);
const groundedBody = await grounded.json();
assert.equal(grounded.status, 200);
assert.equal(groundedBody.release_gate?.decision, "ALLOW");
assert.equal(groundedBody.response, claim, "the host releases the exact claim bound to a trusted active signed lease");

const ungrounded = await worker.fetch(new Request("https://proofttl.test/assistant/text", {
  method: "POST",
  headers: { "content-type": "application/json", "cf-connecting-ip": "203.0.113.92" },
  body: JSON.stringify({ message: "Tell me about ProofTTL product verification." })
}), env, ctx);
const ungroundedBody = await ungrounded.json();
assert.equal(ungrounded.status, 200);
assert.equal(ungroundedBody.release_gate?.decision, "BLOCKED");
assert.doesNotMatch(JSON.stringify(ungroundedBody), /SECRET_UNGROUNDED_DRAFT/, "blocked draft never reaches the HTTP response");
assert.match(ungroundedBody.response, /active, signed Fact Lease/i);

console.log("assistant release gate end-to-end: 7 assertions passed");
