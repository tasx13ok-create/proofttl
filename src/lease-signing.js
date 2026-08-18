export const LEASE_SIGNATURE_VERSION = "proofttl-ed25519-v1";
export const LEASE_ATTESTATION_VERSION = "proofttl-issuance-v1";
export const DEFAULT_SIGNING_KEY_ID = "proofttl-testnet-2026-01";

const textEncoder = new TextEncoder();

export function buildLeaseIssuanceAttestation(lease) {
  if (!lease || typeof lease !== "object") {
    throw new Error("lease_required_for_signing");
  }

  const issuedStatus = lease.issued_status || lease.status || null;
  const required = {
    lease_id: lease.lease_id,
    protocol: lease.protocol,
    claim: lease.claim,
    issued_status: issuedStatus,
    source_url: lease.source_url,
    final_url: lease.final_url || null,
    evidence: lease.evidence ?? null,
    reason: lease.reason ?? null,
    issued_at: lease.issued_at || lease.observed_at,
    expires_at: lease.expires_at,
    ttl_seconds: Number(lease.ttl_seconds),
    source_fingerprint: lease.source_fingerprint,
    confidence: Number(lease.confidence),
    verifier: lease.verifier,
    proof_basis: lease.proof_basis
  };

  for (const [key, value] of Object.entries(required)) {
    if (value === undefined || value === "" || (typeof value === "number" && !Number.isFinite(value))) {
      throw new Error(`lease_attestation_missing_${key}`);
    }
  }

  return {
    attestation_version: LEASE_ATTESTATION_VERSION,
    ...required
  };
}

export function canonicalizeJson(value) {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalizeJson(item)).join(",")}]`;
  }

  const keys = Object.keys(value).sort();
  return `{${keys
    .map((key) => `${JSON.stringify(key)}:${canonicalizeJson(value[key])}`)
    .join(",")}}`;
}

export async function attachLeaseIssuanceSignature(
  lease,
  privateJwkInput,
  keyId = DEFAULT_SIGNING_KEY_ID,
  signedAt = new Date().toISOString()
) {
  const privateJwk = parsePrivateJwk(privateJwkInput);
  if (!privateJwk) return lease;

  const attestation = buildLeaseIssuanceAttestation(lease);
  const canonicalPayload = canonicalizeJson(attestation);
  const privateKey = await crypto.subtle.importKey(
    "jwk",
    privateJwk,
    { name: "Ed25519" },
    false,
    ["sign"]
  );
  const signatureBytes = await crypto.subtle.sign(
    { name: "Ed25519" },
    privateKey,
    textEncoder.encode(canonicalPayload)
  );

  lease.issued_attestation = attestation;
  lease.signature = {
    version: LEASE_SIGNATURE_VERSION,
    algorithm: "Ed25519",
    key_id: normalizeKeyId(keyId),
    signed_payload: "issued_attestation",
    signed_at: signedAt,
    value: base64UrlEncode(new Uint8Array(signatureBytes))
  };

  return lease;
}

export async function verifyLeaseIssuanceSignature(lease, publicJwkInput = null) {
  if (!lease?.issued_attestation || !lease?.signature?.value) return false;
  if (lease.signature.algorithm !== "Ed25519") return false;
  if (lease.signature.version !== LEASE_SIGNATURE_VERSION) return false;

  const publicJwk = publicJwkInput
    ? parsePublicJwk(publicJwkInput)
    : publicJwkFromLeaseOrPrivate(lease);
  if (!publicJwk) return false;

  const expectedAttestation = buildLeaseIssuanceAttestation(lease);
  const expectedCanonical = canonicalizeJson(expectedAttestation);
  const storedCanonical = canonicalizeJson(lease.issued_attestation);
  if (expectedCanonical !== storedCanonical) return false;

  const publicKey = await crypto.subtle.importKey(
    "jwk",
    publicJwk,
    { name: "Ed25519" },
    false,
    ["verify"]
  );

  return crypto.subtle.verify(
    { name: "Ed25519" },
    publicKey,
    base64UrlDecode(lease.signature.value),
    textEncoder.encode(storedCanonical)
  );
}

export function publicSigningJwk(privateJwkInput, keyId = DEFAULT_SIGNING_KEY_ID) {
  const privateJwk = parsePrivateJwk(privateJwkInput);
  if (!privateJwk) return null;

  return {
    kty: "OKP",
    crv: "Ed25519",
    x: privateJwk.x,
    alg: "EdDSA",
    use: "sig",
    kid: normalizeKeyId(keyId)
  };
}

export function signingIsConfigured(privateJwkInput) {
  try {
    return Boolean(parsePrivateJwk(privateJwkInput));
  } catch {
    return false;
  }
}

function parsePrivateJwk(value) {
  if (value === undefined || value === null || value === "") return null;
  const jwk = typeof value === "string" ? JSON.parse(value) : value;
  if (!jwk || typeof jwk !== "object") throw new Error("invalid_signing_private_jwk");
  if (jwk.kty !== "OKP" || jwk.crv !== "Ed25519" || !jwk.x || !jwk.d) {
    throw new Error("signing_private_jwk_must_be_ed25519");
  }
  return jwk;
}

function parsePublicJwk(value) {
  const jwk = typeof value === "string" ? JSON.parse(value) : value;
  if (!jwk || typeof jwk !== "object") return null;
  if (jwk.kty !== "OKP" || jwk.crv !== "Ed25519" || !jwk.x) return null;
  return { kty: "OKP", crv: "Ed25519", x: jwk.x };
}

function publicJwkFromLeaseOrPrivate(lease) {
  const embedded = lease?.signature?.public_key_jwk;
  return embedded ? parsePublicJwk(embedded) : null;
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

function base64UrlDecode(value) {
  const normalized = String(value).replaceAll("-", "+").replaceAll("_", "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
