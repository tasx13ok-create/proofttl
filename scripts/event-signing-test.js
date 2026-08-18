import { canonicalizeJson } from "../src/lease-signing.js";
import {
  EVENT_ATTESTATION_VERSION,
  attachLeaseEventSignatures,
  buildEventAttestation
} from "../src/event-signing.js";

let passed = 0;
const encoder = new TextEncoder();

function assert(condition, message) {
  if (!condition) throw new Error(message);
  passed += 1;
  console.log(`PASS ${passed}: ${message}`);
}

function b64urlDecode(value) {
  const normalized = String(value).replaceAll("-", "+").replaceAll("_", "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  return Uint8Array.from(Buffer.from(padded, "base64"));
}

async function sha256(value) {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(value));
  return `sha256:${Buffer.from(digest).toString("hex")}`;
}

async function verifyEvent(event, leaseId, index, previousHash, publicKey) {
  if (!event?.event_attestation || !event?.event_signature?.value || !event?.event_hash) return false;
  const expected = buildEventAttestation(leaseId, event, index, previousHash);
  const canonical = canonicalizeJson(expected);
  if (canonicalizeJson(event.event_attestation) !== canonical) return false;
  if (event.event_hash !== await sha256(canonical)) return false;
  return crypto.subtle.verify(
    { name: "Ed25519" },
    publicKey,
    b64urlDecode(event.event_signature.value),
    encoder.encode(canonical)
  );
}

function sampleLease() {
  return {
    lease_id: "ftl_event_chain_test_001",
    history: [
      {
        kind: "ISSUED",
        checked_at: "2026-08-18T20:00:00.000Z",
        result: "VERIFIED",
        status: "SUPPORTED",
        source_fingerprint: "sha256:aaa",
        confidence: 0.99
      },
      {
        kind: "AUTO_REVERIFY",
        checked_at: "2026-08-18T20:01:00.000Z",
        result: "UNCHANGED_SOURCE",
        status: "SUPPORTED",
        source_fingerprint: "sha256:aaa"
      },
      {
        kind: "AUTO_REVERIFY",
        checked_at: "2026-08-18T20:02:00.000Z",
        result: "REVOKED",
        status: "CONTRADICTED",
        source_fingerprint: "sha256:bbb",
        reason: "source_changed"
      }
    ]
  };
}

async function verifyChain(lease, publicKey) {
  let previousHash = null;
  for (let index = 0; index < lease.history.length; index += 1) {
    const event = lease.history[index];
    if (!(await verifyEvent(event, lease.lease_id, index, previousHash, publicKey))) return false;
    if (event.event_attestation.previous_event_hash !== previousHash) return false;
    previousHash = event.event_hash;
  }
  return lease.history_chain?.head === previousHash;
}

async function run() {
  console.log("ProofTTL event signing tests\n");

  const pair = await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]);
  const privateJwk = await crypto.subtle.exportKey("jwk", pair.privateKey);
  const publicKey = pair.publicKey;

  const lease = sampleLease();
  await attachLeaseEventSignatures(lease, privateJwk, "proofttl-test-key");

  assert(lease.history_chain?.version === EVENT_ATTESTATION_VERSION, "history chain records event schema version");
  assert(lease.history_chain?.algorithm === "Ed25519+SHA-256", "history chain records signature/hash algorithms");
  assert(lease.history_chain?.events === 3, "history chain records event count");
  assert(Boolean(lease.history_chain?.head), "history chain records a head hash");
  assert(lease.history.every((event) => event.event_signature?.algorithm === "Ed25519"), "every event receives an Ed25519 signature");
  assert(lease.history[0].event_attestation.previous_event_hash === null, "first event has no previous hash");
  assert(lease.history[1].event_attestation.previous_event_hash === lease.history[0].event_hash, "second event links to first event hash");
  assert(lease.history[2].event_attestation.previous_event_hash === lease.history[1].event_hash, "third event links to second event hash");
  assert(await verifyChain(lease, publicKey), "fresh signed event chain verifies end to end");

  const tampered = structuredClone(lease);
  tampered.history[1].status = "CONTRADICTED";
  assert(!(await verifyChain(tampered, publicKey)), "tampering with an event invalidates the chain");

  const reordered = structuredClone(lease);
  [reordered.history[1], reordered.history[2]] = [reordered.history[2], reordered.history[1]];
  assert(!(await verifyChain(reordered, publicKey)), "reordering events invalidates the chain");

  const removed = structuredClone(lease);
  removed.history.splice(1, 1);
  assert(!(await verifyChain(removed, publicKey)), "removing an event invalidates the chain head/links");

  console.log(`\nSUCCESS: ${passed} event-signing checks passed.`);
}

run().catch((error) => {
  console.error("\nEVENT SIGNING TEST FAILED:", error.stack || error.message);
  process.exitCode = 1;
});
