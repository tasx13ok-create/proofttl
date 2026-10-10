const API_BASE = "https://proofttl.tasx13ok.workers.dev";
const MCP_VERSION = "1.0.0";
const MAX_BODY_BYTES = 32_768;

export const PROOFTTL_MCP_TOOLS = [
  { name: "proofttl_health", description: "Read live ProofTTL health and configured verifier. Health is not a claim verdict.", inputSchema: { type: "object", properties: {}, additionalProperties: false } },
  { name: "proofttl_readiness", description: "Read ProofTTL deployment readiness diagnostics.", inputSchema: { type: "object", properties: {}, additionalProperties: false } },
  { name: "proofttl_discovery", description: "Read published ProofTTL capabilities, verdict semantics, endpoints, and payment boundaries.", inputSchema: { type: "object", properties: {}, additionalProperties: false } },
  { name: "proofttl_monitor_status", description: "Read Fact Lease automatic monitoring status and latest run summary.", inputSchema: { type: "object", properties: {}, additionalProperties: false } },
  { name: "proofttl_get_lease", description: "Fetch a stored Fact Lease by exact lease ID. Returns its issuance/current verdict, evidence, expiry, and monitoring state.", inputSchema: { type: "object", properties: { lease_id: { type: "string", minLength: 8, maxLength: 80, pattern: "^[A-Za-z0-9_-]+$" } }, required: ["lease_id"], additionalProperties: false } },
  { name: "proofttl_ask_assistant", description: "Ask ProofTTL's product assistant about ProofTTL, audits, evidence, leases, or the API. This is general assistant output, not a formal claim verdict; uses ProofTTL's assistant quota.", inputSchema: { type: "object", properties: { message: { type: "string", minLength: 1, maxLength: 1200 }, history: { type: "array", maxItems: 6, items: { type: "object", properties: { role: { type: "string", enum: ["user", "assistant"] }, content: { type: "string", maxLength: 600 } }, required: ["role", "content"], additionalProperties: false } } }, required: ["message"], additionalProperties: false } },
  { name: "proofttl_verify_claim", description: "Submit a claim and public source URL to ProofTTL's formal Fact Lease endpoint. This tool does not pay x402. If payment is required, returns the payment challenge and does not claim verification succeeded.", inputSchema: { type: "object", properties: { claim: { type: "string", minLength: 1, maxLength: 1000 }, source_url: { type: "string", minLength: 8, maxLength: 2048 }, ttl_seconds: { type: "integer", minimum: 60, maximum: 604800 } }, required: ["claim", "source_url"], additionalProperties: false } }
];

const json = (body, status = 200, headers = {}) => Response.json(body, { status, headers: { "cache-control": "no-store", ...headers } });
const rpcError = (id, code, message, data) => ({ jsonrpc: "2.0", id: id ?? null, error: { code, message, ...(data === undefined ? {} : { data }) } });
const rpcResult = (id, result) => ({ jsonrpc: "2.0", id, result });
const contentResult = (value, isError = false) => ({ content: [{ type: "text", text: typeof value === "string" ? value : JSON.stringify(value, null, 2) }], ...(isError ? { isError: true } : {}) });

async function requestApi(path, init = {}) {
  const response = await fetch(API_BASE + path, {
    ...init,
    headers: { accept: "application/json", ...(init.body ? { "content-type": "application/json" } : {}), ...(init.headers || {}) },
    signal: AbortSignal.timeout(15000)
  });
  const raw = await response.text();
  let body;
  try { body = JSON.parse(raw); } catch { body = { response_text: raw.slice(0, 3000) }; }
  const headers = {};
  for (const key of ["payment-required", "www-authenticate", "retry-after", "content-type"]) {
    const value = response.headers.get(key);
    if (value) headers[key] = value;
  }
  return { http_status: response.status, headers, body };
}

async function runTool(name, args = {}) {
  if (name === "proofttl_health") return contentResult(await requestApi("/health"));
  if (name === "proofttl_readiness") return contentResult(await requestApi("/readiness"));
  if (name === "proofttl_discovery") return contentResult(await requestApi("/.well-known/proofttl.json"));
  if (name === "proofttl_monitor_status") return contentResult(await requestApi("/monitor/status"));
  if (name === "proofttl_get_lease") {
    const id = String(args.lease_id || "").trim();
    if (!/^[A-Za-z0-9_-]{8,80}$/.test(id)) return contentResult({ error: "invalid_lease_id" }, true);
    const result = await requestApi("/lease/" + encodeURIComponent(id));
    return contentResult(result, result.http_status >= 400);
  }
  if (name === "proofttl_ask_assistant") {
    const message = typeof args.message === "string" ? args.message.trim() : "";
    if (!message || message.length > 1200) return contentResult({ error: "message_required_or_too_long" }, true);
    const history = Array.isArray(args.history) ? args.history.slice(0, 6).map(item => ({ role: item.role, content: String(item.content || "").slice(0, 600) })) : [];
    const result = await requestApi("/assistant/text", { method: "POST", body: JSON.stringify({ message, history }) });
    return contentResult({ ...result, interpretation: "ProofTTL assistant response; not a formal verification verdict." }, result.http_status >= 400);
  }
  if (name === "proofttl_verify_claim") {
    const claim = typeof args.claim === "string" ? args.claim.trim() : "";
    const source = typeof args.source_url === "string" ? args.source_url.trim() : "";
    if (!claim || claim.length > 1000) return contentResult({ error: "claim_required_or_too_long" }, true);
    let parsed;
    try { parsed = new URL(source); } catch { return contentResult({ error: "invalid_source_url" }, true); }
    if (!["https:", "http:"].includes(parsed.protocol) || parsed.username || parsed.password) return contentResult({ error: "source_url_must_be_http_or_https_without_credentials" }, true);
    const ttl = Number.isInteger(args.ttl_seconds) ? Math.max(60, Math.min(604800, args.ttl_seconds)) : 3600;
    const result = await requestApi("/verify", { method: "POST", body: JSON.stringify({ claim, source_url: parsed.toString(), ttl_seconds: ttl }) });
    if (result.http_status === 402) return contentResult({ outcome: "payment_required", lease_issued: false, payment: { price: "$0.001", network: "Base Sepolia (eip155:84532)", asset: "USDC", note: "No payment was sent by this MCP server." }, response: result });
    return contentResult({ ...result, lease_issued: result.http_status >= 200 && result.http_status < 300 && Boolean(result.body?.lease_id) }, result.http_status >= 400);
  }
  return contentResult({ error: "unknown_tool", name }, true);
}

async function handleRpc(message) {
  if (!message || message.jsonrpc !== "2.0" || typeof message.method !== "string") return rpcError(message?.id, -32600, "Invalid Request");
  if (message.method.startsWith("notifications/")) return null;
  if (message.method === "initialize") return rpcResult(message.id, {
    protocolVersion: "2025-03-26",
    capabilities: { tools: { listChanged: false } },
    serverInfo: { name: "proofttl-mcp", version: MCP_VERSION },
    instructions: "Call ProofTTL tools for live service state, Fact Lease lookup, and claim verification. Clearly separate formal ProofTTL verdicts from the ProofTTL assistant. Formal verification is x402 payment-gated; this MCP endpoint does not submit payment."
  });
  if (message.method === "ping") return rpcResult(message.id, {});
  if (message.method === "tools/list") return rpcResult(message.id, { tools: PROOFTTL_MCP_TOOLS });
  if (message.method === "tools/call") {
    const name = message.params?.name;
    if (!PROOFTTL_MCP_TOOLS.some(tool => tool.name === name)) return rpcError(message.id, -32602, "Unknown tool", { name });
    try { return rpcResult(message.id, await runTool(name, message.params?.arguments || {})); }
    catch (error) { return rpcResult(message.id, contentResult({ error: "upstream_request_failed", error_type: error?.name || "Error" }, true)); }
  }
  return rpcError(message.id, -32601, "Method not found", { method: message.method });
}

export async function handleProofTTLMcp(request) {
  const url = new URL(request.url);
  if (request.method === "GET" && (url.pathname === "/mcp" || url.pathname === "/mcp/")) {
    return json({ service: "ProofTTL MCP", version: MCP_VERSION, protocol: "MCP Streamable HTTP / JSON-RPC 2.0", endpoint: "/mcp", tools: PROOFTTL_MCP_TOOLS.map(tool => tool.name), payment_policy: "No automatic x402 payments" });
  }
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: { "access-control-allow-origin": "*", "access-control-allow-methods": "GET, POST, OPTIONS", "access-control-allow-headers": "content-type, accept, mcp-protocol-version", "access-control-max-age": "86400" } });
  if (request.method !== "POST") return json({ error: "method_not_allowed", allow: ["GET", "POST", "OPTIONS"] }, 405, { allow: "GET, POST, OPTIONS" });
  const length = Number(request.headers.get("content-length") || 0);
  if (length > MAX_BODY_BYTES) return json({ error: "request_too_large" }, 413);
  let body;
  try { body = await request.json(); } catch { return json(rpcError(null, -32700, "Parse error"), 400); }
  const origin = request.headers.get("origin");
  const corsHeaders = { "access-control-allow-origin": origin || "*", vary: "Origin" };
  if (Array.isArray(body)) {
    if (body.length > 20) return json(rpcError(null, -32600, "Batch too large"), 400, corsHeaders);
    const results = [];
    for (const message of body) {
      const result = await handleRpc(message);
      if (result) results.push(result);
    }
    return results.length ? json(results, 200, corsHeaders) : new Response(null, { status: 202, headers: corsHeaders });
  }
  const result = await handleRpc(body);
  return result ? json(result, 200, corsHeaders) : new Response(null, { status: 202, headers: corsHeaders });
}
