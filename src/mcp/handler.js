import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { authenticateMcpRequest, requireMcpAuthConfiguration } from "./auth.js";
import { boundedSetting, McpBoundaryError, readBoundedJson } from "./boundary.js";
import { TOOL_INPUT_SCHEMAS } from "./schemas.js";
import { createMcpServer } from "./server.js";
import { createObserver, errorCategory } from "./observability.js";

const ACCEPTED_HEADERS = ["authorization", "content-type", "mcp-protocol-version", "mcp-session-id", "last-event-id"];

function allowedOrigin(request, env) {
  const origin = request.headers.get("origin");
  const own = new URL(request.url).origin;
  const configured = String(env?.PROOFTTL_MCP_ALLOWED_ORIGINS || "").split(",").map(item => item.trim()).filter(Boolean);
  const allowed = new Set([own]);
  for (const item of configured) {
    try {
      const url = new URL(item);
      if (url.origin !== item || url.username || url.password || !["https:", "http:"].includes(url.protocol)) throw new Error();
      allowed.add(item);
    } catch {
      throw new McpBoundaryError("mcp_origin_configuration_invalid", 503, "MCP allowed origins are misconfigured.");
    }
  }
  if (origin !== null && !allowed.has(origin)) throw new McpBoundaryError("origin_forbidden", 403, "Origin is not allowed.");
  return origin;
}

function protect(response, origin) {
  const headers = new Headers(response.headers);
  headers.set("cache-control", "no-store");
  headers.set("x-content-type-options", "nosniff");
  headers.set("vary", "Origin");
  if (origin) {
    headers.set("access-control-allow-origin", origin);
    headers.set("access-control-expose-headers", "mcp-protocol-version");
  }
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

function rpcError(status, code, message, id = null, data, headers = {}) {
  return Response.json({ jsonrpc: "2.0", id, error: { code, message, ...(data ? { data } : {}) } }, { status, headers });
}

function preflight(request) {
  const method = request.headers.get("access-control-request-method");
  const requested = (request.headers.get("access-control-request-headers") || "").split(",").map(item => item.trim().toLowerCase()).filter(Boolean);
  if ((method && !["POST", "GET", "DELETE"].includes(method)) || requested.some(item => !ACCEPTED_HEADERS.includes(item))) {
    throw new McpBoundaryError("preflight_forbidden", 403, "MCP preflight is not allowed.");
  }
  return new Response(null, { status: 204, headers: {
    "access-control-allow-methods": "POST, GET, DELETE, OPTIONS",
    "access-control-allow-headers": ACCEPTED_HEADERS.join(", "),
    "access-control-max-age": "600"
  } });
}

export async function handleMcpRequest(request, env, options = {}) {
  let origin = null;
  let server;
  let requestId = null;
  let observer = await createObserver(env);
  const started = performance.now();
  try {
    origin = allowedOrigin(request, env);
    (options.requireAuthConfiguration || requireMcpAuthConfiguration)(env);
    if (request.method === "OPTIONS") return protect(preflight(request), origin);
    const { tenantId } = await (options.authenticate || authenticateMcpRequest)(request, env);
    if (typeof tenantId !== "string" || !/^[A-Za-z0-9:_-]{1,200}$/.test(tenantId)) throw new McpBoundaryError("invalid_bearer_token", 401, "Invalid authenticated tenant.");
    observer = await createObserver(env, tenantId);
    observer.emit("auth", {category:"success"});
    if (env?.VERIFY_RATE_LIMITER) {
      let rate;
      try { rate = await env.VERIFY_RATE_LIMITER.limit({ key: "mcp:" + tenantId }); }
      catch { throw new McpBoundaryError("mcp_rate_limiter_unavailable", 503, "MCP rate limiting is unavailable."); }
      if (!rate?.success) throw new McpBoundaryError("mcp_rate_limit_exceeded", 429, "MCP tenant request limit exceeded.");
    }
    if (request.method !== "POST") {
      return protect(rpcError(405, -32000, "This stateless endpoint does not offer standalone SSE or session deletion.", null, { code: "method_not_allowed" }, { allow: "POST, OPTIONS" }), origin);
    }
    const contentType = (request.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
    if (contentType !== "application/json") throw new McpBoundaryError("unsupported_content_type", 415, "Content-Type must be application/json.");
    const maxBytes = boundedSetting(env?.PROOFTTL_MCP_MAX_REQUEST_BYTES, 1048576, 1024, 1048576);
    const timeout = boundedSetting(env?.PROOFTTL_MCP_TIMEOUT_MS, 30000, 10, 60000);
    const body = await readBoundedJson(request, maxBytes, timeout);
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return protect(rpcError(400, -32600, "A single JSON-RPC message is required."), origin);
    }
    if (body.jsonrpc !== "2.0") return protect(rpcError(400, -32600, "JSON-RPC version must be 2.0."), origin);
    requestId = typeof body.id === "string" || (typeof body.id === "number" && Number.isFinite(body.id)) ? body.id : null;
    if (body.method === "tools/call") {
      if (requestId === null) return protect(rpcError(400, -32600, "Tool calls require a string or numeric request ID."), origin);
      const schema = TOOL_INPUT_SCHEMAS[body.params?.name];
      if (!schema || !Object.hasOwn(TOOL_INPUT_SCHEMAS, body.params?.name)) {
        return protect(rpcError(400, -32602, "Unknown ProofTTL tool.", requestId, { code: "unknown_tool" }), origin);
      }
      const validated = schema.safeParse(body.params?.arguments);
      if (!validated.success) {
        const issues = validated.error.issues.map(issue => ({ path: issue.path, code: issue.code }));
        return protect(rpcError(400, -32602, "Invalid tool arguments.", requestId, { code: "invalid_arguments", issues }), origin);
      }
    }
    if (body.method === "initialize") observer.emit("mcp_initialize");
    server = createMcpServer({ tenantId, env, observer, requestSignal: request.signal, ...(options.executeTool ? { execute: options.executeTool } : {}) });
    const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    await server.connect(transport);
    const response = await transport.handleRequest(request, { parsedBody: body });
    observer.emit("request_complete", {status:response.status,latency_ms:performance.now()-started});
    return protect(response, origin);
  } catch (error) {
    const expected = error instanceof McpBoundaryError;
    const status = expected ? error.status : 500;
    const code = expected ? error.code : "mcp_internal_error";
    observer.emit(status === 401 ? "auth" : status >= 500 ? "server_error" : "refusal", {category:errorCategory(error),status,latency_ms:performance.now()-started});
    const headers = status === 401 ? { "www-authenticate": 'Bearer realm="proofttl-mcp"' } : {};
    return protect(rpcError(status, code === "invalid_json" ? -32700 : -32000, expected ? error.message : "MCP request failed.", requestId, { code }, headers), origin);
  } finally {
    if (server) await server.close().catch(() => {});
  }
}
