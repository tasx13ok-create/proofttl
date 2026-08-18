import { authTrustedOrigins } from "./auth.js";

const AUTH_ALLOW_METHODS = "GET, POST, OPTIONS";
const AUTH_ALLOW_HEADERS = "Content-Type, Authorization, X-Requested-With";
const AUTH_EXPOSE_HEADERS = "Content-Length, Set-Cookie";

function requestOrigin(request) {
  const value = request.headers.get("origin");
  if (!value) return null;
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

export function isAllowedAuthOrigin(request, env) {
  const origin = requestOrigin(request);
  if (!origin) return true;
  return authTrustedOrigins(env, request).includes(origin);
}

export function applyAuthCors(response, request, env) {
  const origin = requestOrigin(request);
  if (!origin) return response;
  if (!isAllowedAuthOrigin(request, env)) return response;

  const headers = new Headers(response.headers);
  headers.set("access-control-allow-origin", origin);
  headers.set("access-control-allow-credentials", "true");
  headers.set("access-control-allow-methods", AUTH_ALLOW_METHODS);
  headers.set("access-control-allow-headers", AUTH_ALLOW_HEADERS);
  headers.set("access-control-expose-headers", AUTH_EXPOSE_HEADERS);
  headers.set("access-control-max-age", "600");
  headers.append("vary", "Origin");

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}

export function authPreflightResponse(request, env) {
  const origin = requestOrigin(request);
  if (!origin || !isAllowedAuthOrigin(request, env)) {
    return Response.json(
      { error: "auth_origin_not_allowed" },
      { status: 403, headers: { "cache-control": "no-store" } }
    );
  }
  return applyAuthCors(new Response(null, { status: 204 }), request, env);
}
