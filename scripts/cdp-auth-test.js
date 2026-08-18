import {
  CDP_FACILITATOR_URL,
  createCdpFacilitatorAuthHeaders,
  generateCdpJwt
} from "../src/cdp-auth.js";

let checks = 0;

console.log("ProofTTL CDP facilitator authentication regression test\n");

const keyPair = await crypto.subtle.generateKey(
  { name: "Ed25519" },
  true,
  ["sign", "verify"]
);
const privateJwk = await crypto.subtle.exportKey("jwk", keyPair.privateKey);
const secretBytes = new Uint8Array(64);
secretBytes.set(decodeBase64Url(privateJwk.d), 0);
secretBytes.set(decodeBase64Url(privateJwk.x), 32);

const apiKeyId = "organizations/test-org/apiKeys/test-key";
const apiKeySecret = Buffer.from(secretBytes).toString("base64");
const fixedNow = 1787025600;

const token = await generateCdpJwt({
  apiKeyId,
  apiKeySecret,
  requestMethod: "POST",
  requestHost: "api.cdp.coinbase.com",
  requestPath: "/platform/v2/x402/verify",
  nowSeconds: fixedNow
});

const decoded = decodeJwt(token);
pass(decoded.header.alg === "EdDSA", "JWT uses EdDSA");
pass(decoded.header.kid === apiKeyId, "JWT header carries the CDP API key id");
pass(decoded.header.typ === "JWT", "JWT header declares JWT type");
pass(/^[0-9a-f]{32}$/.test(decoded.header.nonce), "JWT header carries a random 16-byte hex nonce");
pass(decoded.payload.sub === apiKeyId, "JWT subject is the CDP API key id");
pass(decoded.payload.iss === "cdp", "JWT issuer is cdp");
pass(
  Array.isArray(decoded.payload.uris) &&
    decoded.payload.uris[0] === "POST api.cdp.coinbase.com/platform/v2/x402/verify",
  "JWT is bound to the exact facilitator verify URI"
);
pass(decoded.payload.iat === fixedNow, "JWT iat uses the requested timestamp");
pass(decoded.payload.nbf === fixedNow, "JWT nbf uses the requested timestamp");
pass(decoded.payload.exp === fixedNow + 120, "JWT expires after 120 seconds");
pass(
  await crypto.subtle.verify(
    { name: "Ed25519" },
    keyPair.publicKey,
    decoded.signature,
    new TextEncoder().encode(decoded.signingInput)
  ),
  "JWT signature verifies against the Ed25519 public key"
);

const createAuthHeaders = createCdpFacilitatorAuthHeaders({
  apiKeyId,
  apiKeySecret
});
const headers = await createAuthHeaders();

pass(CDP_FACILITATOR_URL === "https://api.cdp.coinbase.com/platform/v2/x402", "CDP facilitator URL is pinned correctly");
passBearerUri(headers.verify?.Authorization, "POST api.cdp.coinbase.com/platform/v2/x402/verify", "verify auth token is URI-bound");
passBearerUri(headers.settle?.Authorization, "POST api.cdp.coinbase.com/platform/v2/x402/settle", "settle auth token is URI-bound");
passBearerUri(headers.supported?.Authorization, "GET api.cdp.coinbase.com/platform/v2/x402/supported", "supported auth token is URI-bound");

let invalidSecretRejected = false;
try {
  await generateCdpJwt({
    apiKeyId,
    apiKeySecret: Buffer.alloc(32).toString("base64"),
    requestMethod: "GET",
    requestHost: "api.cdp.coinbase.com",
    requestPath: "/platform/v2/x402/supported"
  });
} catch (error) {
  invalidSecretRejected = /64-byte Ed25519 key/.test(String(error?.message || error));
}
pass(invalidSecretRejected, "invalid CDP Ed25519 secret length is rejected safely");

console.log(`\nSUCCESS: ${checks} ProofTTL CDP authentication checks passed.`);

function pass(condition, message) {
  if (!condition) throw new Error(`FAIL ${checks + 1}: ${message}`);
  checks += 1;
  console.log(`PASS ${checks}: ${message}`);
}

function passBearerUri(authorization, expectedUri, message) {
  if (typeof authorization !== "string" || !authorization.startsWith("Bearer ")) {
    pass(false, message);
    return;
  }
  const parsed = decodeJwt(authorization.slice("Bearer ".length));
  pass(parsed.payload.uris?.[0] === expectedUri, message);
}

function decodeJwt(token) {
  const parts = String(token).split(".");
  if (parts.length !== 3) throw new Error("JWT must have three segments");
  const [encodedHeader, encodedPayload, encodedSignature] = parts;
  return {
    header: JSON.parse(Buffer.from(encodedHeader, "base64url").toString("utf8")),
    payload: JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8")),
    signature: Buffer.from(encodedSignature, "base64url"),
    signingInput: `${encodedHeader}.${encodedPayload}`
  };
}

function decodeBase64Url(value) {
  return Buffer.from(value, "base64url");
}
