import { McpBoundaryError } from "./boundary.js";

export const MCP_TOKEN_AUDIENCE = "proofttl-mcp";
const encoder = new TextEncoder();

export function requireMcpAuthConfiguration(env) {
  const secret = env?.PROOFTTL_MCP_AUTH_SECRET;
  if (typeof secret !== "string" || encoder.encode(secret).byteLength < 32) {
    throw new McpBoundaryError("mcp_auth_not_configured", 503, "MCP tenant authentication is not configured.");
  }
  return secret;
}

function decodeBase64url(value) {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error("invalid_encoding");
  const raw = value.replaceAll("-", "+").replaceAll("_", "/");
  return Uint8Array.from(atob(raw + "=".repeat((4 - raw.length % 4) % 4)), c => c.charCodeAt(0));
}

function objectPart(value) {
  const object = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(decodeBase64url(value)));
  if (!object || typeof object !== "object" || Array.isArray(object)) throw new Error("invalid_object");
  return object;
}

export async function authenticateMcpRequest(request, env) {
  const secret = requireMcpAuthConfiguration(env);
  const authorization = request.headers.get("authorization") || "";
  const match = authorization.length <= 4096 && authorization.match(/^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/i);
  if (!match) throw new McpBoundaryError("authentication_required", 401, "A tenant bearer token is required.");
  try {
    const [headerPart, payloadPart, signaturePart] = match[1].split(".");
    const header = objectPart(headerPart);
    if (header.alg !== "HS256" || header.typ !== "JWT" || Object.keys(header).some(key => !["alg", "typ"].includes(key))) {
      throw new Error("invalid_header");
    }
    const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
    const signature = decodeBase64url(signaturePart);
    if (signature.byteLength !== 32 || !(await crypto.subtle.verify("HMAC", key, signature, encoder.encode(headerPart + "." + payloadPart)))) {
      throw new Error("invalid_signature");
    }
    const claims = objectPart(payloadPart);
    const now = Math.floor(Date.now() / 1000);
    if (claims.aud !== MCP_TOKEN_AUDIENCE || typeof claims.sub !== "string" || !/^[A-Za-z0-9:_-]{1,200}$/.test(claims.sub) ||
      !Number.isSafeInteger(claims.exp) || claims.exp <= now ||
      (claims.nbf !== undefined && (!Number.isSafeInteger(claims.nbf) || claims.nbf > now)) ||
      (claims.iat !== undefined && (!Number.isSafeInteger(claims.iat) || claims.iat > now + 30))) {
      throw new Error("invalid_claims");
    }
    return { tenantId: claims.sub };
  } catch {
    throw new McpBoundaryError("invalid_bearer_token", 401, "The tenant bearer token is invalid or expired.");
  }
}
