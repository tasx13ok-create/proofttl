import { canonicalizeJson, DEFAULT_SIGNING_KEY_ID, LEASE_SIGNATURE_VERSION } from "./lease-signing.js";

export const EVENT_ATTESTATION_VERSION = "proofttl-event-v1";
const textEncoder = new TextEncoder();

export async function attachLeaseEventSignatures(
  lease,
  privateJwkInput,
  keyId = DEFAULT_SIGNING_KEY_ID
) {
  const privateJwk = parsePrivateJwk(privateJwkInput);
  if (!privateJwk || !Array.isArray(lease?.history) || !lease.lease_id) return lease;

  const privateKey = await crypto.subtle.importKey(
    "jwk",
    privateJwk,
    { name: "Ed25519" },
    false,
    ["sign"]
  );

  let previousHash = null;
  for (let index = 0; index < lease.history.length; index += 1) {
    const event = lease.history[index];
    if (!event || typeof event !== "object") continue;

    const attestation = buildEventAttestation(lease.lease_id, event, index, previousHash);
    const canonical = canonicalizeJson(attestation);
    const eventHash = `sha256:${await sha256(canonical)}`;

    const existing = event.event_attestation && event.event_signature;
    if (!existing || canonicalizeJson(event.event_attestation) !== canonical) {
      const signatureBytes = await crypto.subtle.sign(
        { name: "Ed25519" },
        privateKey,
        textEncoder.encode(canonical)
      );
      event.event_attestation = attestation;
      event.event_signature = {
        version: LEASE_SIGNATURE_VERSION,
        algorithm: "Ed25519",
        key_id: normalizeKeyId(keyId),
        signed_payload: "event_attestation",
        signed_at: event.checked_at || new Date().toISOString(),
        value: base64UrlEncode(new Uint8Array(signatureBytes))
      };
    }

    event.event_hash = eventHash;
    previousHash = eventHash;
  }

  lease.history_chain = {
    version: EVENT_ATTESTATION_VERSION,
    algorithm: "Ed25519+SHA-256",
    events: lease.history.length,
    head: previousHash,
    key_id: normalizeKeyId(keyId)
  };
  return lease;
}

export function buildEventAttestation(leaseId, event, index, previousEventHash = null) {
  const clean = {};
  for (const [key, value] of Object.entries(event || {})) {
    if (key === "event_attestation" || key === "event_signature" || key === "event_hash") continue;
    clean[key] = value;
  }
  return {
    attestation_version: EVENT_ATTESTATION_VERSION,
    lease_id: leaseId,
    event_index: index,
    previous_event_hash: previousEventHash,
    event: clean
  };
}

async function sha256(value) {
  const digest = await crypto.subtle.digest("SHA-256", textEncoder.encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function parsePrivateJwk(value) {
  if (value === undefined || value === null || value === "") return null;
  const jwk = typeof value === "string" ? JSON.parse(value) : value;
  if (!jwk || typeof jwk !== "object" || jwk.kty !== "OKP" || jwk.crv !== "Ed25519" || !jwk.x || !jwk.d) {
    throw new Error("event_signing_private_jwk_must_be_ed25519");
  }
  return jwk;
}

function normalizeKeyId(value) {
  const keyId = typeof value === "string" ? value.trim() : "";
  return keyId || DEFAULT_SIGNING_KEY_ID;
}

function base64UrlEncode(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/g, "");
}
