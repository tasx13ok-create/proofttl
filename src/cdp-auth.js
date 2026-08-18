export const CDP_FACILITATOR_URL = "https://api.cdp.coinbase.com/platform/v2/x402";

const CDP_FACILITATOR_HOST = "api.cdp.coinbase.com";
const CDP_FACILITATOR_PATHS = Object.freeze({
  verify: "/platform/v2/x402/verify",
  settle: "/platform/v2/x402/settle",
  supported: "/platform/v2/x402/supported"
});
const DEFAULT_JWT_TTL_SECONDS = 120;

/**
 * Build the per-endpoint Authorization headers expected by CDP's hosted x402
 * facilitator. A fresh JWT is generated for each operation and is bound to the
 * exact HTTP method, host, and path, matching Coinbase's CDP SDK behavior.
 */
export function createCdpFacilitatorAuthHeaders({ apiKeyId, apiKeySecret }) {
  const credentials = normalizeCredentials(apiKeyId, apiKeySecret);

  return async function createAuthHeaders() {
    const [verifyJwt, settleJwt, supportedJwt] = await Promise.all([
      generateCdpJwt({
        ...credentials,
        requestMethod: "POST",
        requestHost: CDP_FACILITATOR_HOST,
        requestPath: CDP_FACILITATOR_PATHS.verify
      }),
      generateCdpJwt({
        ...credentials,
        requestMethod: "POST",
        requestHost: CDP_FACILITATOR_HOST,
        requestPath: CDP_FACILITATOR_PATHS.settle
      }),
      generateCdpJwt({
        ...credentials,
        requestMethod: "GET",
        requestHost: CDP_FACILITATOR_HOST,
        requestPath: CDP_FACILITATOR_PATHS.supported
      })
    ]);

    return {
      verify: { Authorization: `Bearer ${verifyJwt}` },
      settle: { Authorization: `Bearer ${settleJwt}` },
      supported: { Authorization: `Bearer ${supportedJwt}` }
    };
  };
}

/**
 * Generate an Ed25519 CDP JWT without importing the full CDP SDK. CDP Ed25519
 * secrets are base64-encoded 64-byte values: 32-byte seed + 32-byte public key.
 * The resulting protected header and claims mirror Coinbase's TypeScript SDK.
 */
export async function generateCdpJwt({
  apiKeyId,
  apiKeySecret,
  requestMethod,
  requestHost,
  requestPath,
  expiresIn = DEFAULT_JWT_TTL_SECONDS,
  nowSeconds = Math.floor(Date.now() / 1000)
}) {
  const credentials = normalizeCredentials(apiKeyId, apiKeySecret);
  const method = requiredString(requestMethod, "requestMethod").toUpperCase();
  const host = requiredString(requestHost, "requestHost");
  const path = requiredString(requestPath, "requestPath");

  if (!Number.isSafeInteger(expiresIn) || expiresIn <= 0 || expiresIn > 120) {
    throw new Error("CDP JWT expiresIn must be an integer from 1 to 120 seconds.");
  }
  if (!Number.isSafeInteger(nowSeconds) || nowSeconds <= 0) {
    throw new Error("CDP JWT nowSeconds must be a positive integer Unix timestamp.");
  }

  const decoded = decodeBase64(credentials.apiKeySecret);
  if (decoded.length !== 64) {
    throw new Error("CDP_API_KEY_SECRET must decode to a 64-byte Ed25519 key.");
  }

  const seed = decoded.slice(0, 32);
  const publicKey = decoded.slice(32, 64);
  const signingKey = await crypto.subtle.importKey(
    "jwk",
    {
      kty: "OKP",
      crv: "Ed25519",
      d: encodeBase64Url(seed),
      x: encodeBase64Url(publicKey),
      key_ops: ["sign"],
      ext: false
    },
    { name: "Ed25519" },
    false,
    ["sign"]
  );

  const nonce = new Uint8Array(16);
  crypto.getRandomValues(nonce);

  const header = {
    alg: "EdDSA",
    kid: credentials.apiKeyId,
    typ: "JWT",
    nonce: bytesToHex(nonce)
  };
  const payload = {
    sub: credentials.apiKeyId,
    iss: "cdp",
    uris: [`${method} ${host}${path}`],
    iat: nowSeconds,
    nbf: nowSeconds,
    exp: nowSeconds + expiresIn
  };

  const encoder = new TextEncoder();
  const encodedHeader = encodeBase64Url(encoder.encode(JSON.stringify(header)));
  const encodedPayload = encodeBase64Url(encoder.encode(JSON.stringify(payload)));
  const signingInput = `${encodedHeader}.${encodedPayload}`;
  const signature = new Uint8Array(
    await crypto.subtle.sign(
      { name: "Ed25519" },
      signingKey,
      encoder.encode(signingInput)
    )
  );

  return `${signingInput}.${encodeBase64Url(signature)}`;
}

function normalizeCredentials(apiKeyId, apiKeySecret) {
  const normalizedId = requiredString(apiKeyId, "CDP_API_KEY_ID").trim();
  const normalizedSecret = requiredString(apiKeySecret, "CDP_API_KEY_SECRET")
    .trim()
    .replace(/\s+/g, "");

  return {
    apiKeyId: normalizedId,
    apiKeySecret: normalizedSecret
  };
}

function requiredString(value, name) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${name} is required.`);
  }
  return value;
}

function decodeBase64(value) {
  try {
    const binary = atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  } catch {
    throw new Error("CDP_API_KEY_SECRET is not valid base64.");
  }
}

function encodeBase64Url(bytes) {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function bytesToHex(bytes) {
  return Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
}
