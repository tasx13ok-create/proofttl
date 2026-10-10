import { publicSigningJwk, signingIsConfigured } from "./lease-signing.js";

const KEYRING_ENV = "PROOFTTL_SIGNING_KEYRING_JSON";

export function parseSigningKeyring(value) {
  if (!value) return { active_kid: null, keys: [] };
  const parsed = typeof value === "string" ? JSON.parse(value) : value;
  if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.keys)) {
    throw new Error("invalid_signing_keyring");
  }
  const activeKid = typeof parsed.active_kid === "string" ? parsed.active_kid.trim() : "";
  const seen = new Set();
  const keys = parsed.keys.map((entry) => {
    const kid = typeof entry?.kid === "string" ? entry.kid.trim() : "";
    const revoked = entry?.revoked === true;
    const privateJwk = entry?.private_jwk || null;
    const publicJwk = entry?.public_jwk || (privateJwk ? publicSigningJwk(privateJwk, kid) : null);
    if (!kid || seen.has(kid)) throw new Error("signing_key_ids_missing_or_duplicated");
    seen.add(kid);
    if (!revoked && (!publicJwk || publicJwk.kid !== kid && publicJwk.kid !== undefined)) {
      throw new Error("signing_key_public_material_invalid");
    }
    return { kid, revoked, private_jwk: privateJwk, public_jwk: publicJwk };
  });
  if (activeKid && !keys.some((key) => key.kid === activeKid && !key.revoked && signingIsConfigured(key.private_jwk))) {
    throw new Error("active_signing_key_unavailable");
  }
  return { active_kid: activeKid || null, keys };
}

export function signingConfigFromEnv(env) {
  const ringValue = env?.[KEYRING_ENV];
  if (ringValue) {
    const ring = parseSigningKeyring(ringValue);
    const active = ring.keys.find((key) => key.kid === ring.active_kid && !key.revoked);
    if (!active || !signingIsConfigured(active.private_jwk)) {
      throw new Error("active_signing_key_unavailable");
    }
    return {
      active_kid: active.kid,
      active_private_jwk: active.private_jwk,
      public_keys: ring.keys.filter((key) => !key.revoked && key.public_jwk).map((key) => ({
        ...key.public_jwk,
        kid: key.kid
      })),
      revoked_kids: ring.keys.filter((key) => key.revoked).map((key) => key.kid)
    };
  }

  const privateJwk = env?.PROOFTTL_SIGNING_PRIVATE_JWK || env?.PROOFTTL_LEASE_SIGNING_PRIVATE_JWK;
  if (!signingIsConfigured(privateJwk)) {
    return { active_kid: null, active_private_jwk: null, public_keys: [], revoked_kids: [] };
  }
  const keyId = env?.PROOFTTL_SIGNING_KEY_ID || env?.PROOFTTL_LEASE_SIGNING_KEY_ID || "proofttl-testnet-2026-01";
  return {
    active_kid: keyId,
    active_private_jwk: privateJwk,
    public_keys: [publicSigningJwk(privateJwk, keyId)],
    revoked_kids: []
  };
}

export function publicSigningKeySet(env) {
  const config = signingConfigFromEnv(env);
  return {
    keys: config.public_keys,
    active_kid: config.active_kid,
    revoked_kids: config.revoked_kids
  };
}
