import { createSqliteD1 } from "./helpers/sqlite-d1.js";

export async function createMcpTestToken(env, payloadOverrides = {}, headerOverrides = {}) {
  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT", ...headerOverrides })).toString("base64url");
  const payload = Buffer.from(JSON.stringify({ aud: "proofttl-mcp", sub: "tenant_a", iat: now, exp: now + 300, ...payloadOverrides })).toString("base64url");
  const signed = header + "." + payload;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(env.PROOFTTL_MCP_AUTH_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = Buffer.from(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(signed))).toString("base64url");
  return signed + "." + signature;
}

export async function createMcpTestEnv({ tenantId = "tenant_a" } = {}) {
  const signing = await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]);
  const privateJwk = await crypto.subtle.exportKey("jwk", signing.privateKey);
  const publicJwk = await crypto.subtle.exportKey("jwk", signing.publicKey);
  const env = {
    MONITOR_DB: createSqliteD1(),
    PROOFTTL_MCP_AUTH_SECRET: Buffer.from(crypto.getRandomValues(new Uint8Array(48))).toString("base64url"),
    PROOFTTL_SIGNING_PRIVATE_JWK: JSON.stringify(privateJwk),
    PROOFTTL_SIGNING_KEY_ID: "ci-ephemeral-signing-key"
  };
  const token = await createMcpTestToken(env, { sub: tenantId });
  return { env, token, tenantId, publicJwk, close() { env.MONITOR_DB.close(); } };
}

export function makeMcpRequest(body, { token, url = "https://proofttl.test/mcp", headers = {}, signal } = {}) {
  return new Request(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      "mcp-protocol-version": "2025-11-25",
      ...(token ? { authorization: "Bearer " + token } : {}),
      ...headers
    },
    body: typeof body === "string" ? body : JSON.stringify(body),
    ...(signal ? { signal } : {})
  });
}
