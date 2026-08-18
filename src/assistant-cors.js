import { authTrustedOrigins } from "./auth.js";

const ASSISTANT_ALLOW_METHODS = "GET, POST, OPTIONS";
const ASSISTANT_ALLOW_HEADERS = "Content-Type, Authorization";
const ASSISTANT_EXPOSE_HEADERS = "Retry-After";

function requestOrigin(request) {
  const value = request.headers.get("origin");
  if (!value) return null;
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

export function isTrustedAssistantOrigin(request, env) {
  const origin = requestOrigin(request);
  if (!origin) return false;
  return authTrustedOrigins(env, request).includes(origin);
}

export function applyAssistantCors(response, request, env) {
  const headers = new Headers(response.headers);
  const origin = requestOrigin(request);

  if (origin && isTrustedAssistantOrigin(request, env)) {
    headers.set("access-control-allow-origin", origin);
    headers.set("access-control-allow-credentials", "true");
    headers.append("vary", "Origin");
  } else {
    headers.set("access-control-allow-origin", "*");
    headers.delete("access-control-allow-credentials");
  }

  headers.set("access-control-allow-methods", ASSISTANT_ALLOW_METHODS);
  headers.set("access-control-allow-headers", ASSISTANT_ALLOW_HEADERS);
  headers.set("access-control-expose-headers", ASSISTANT_EXPOSE_HEADERS);
  headers.set("access-control-max-age", "600");

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}

export function assistantPreflightResponse(request, env) {
  return applyAssistantCors(new Response(null, { status: 204 }), request, env);
}
