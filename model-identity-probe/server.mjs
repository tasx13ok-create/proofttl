import http from "node:http";
import { readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const dir = dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT || 3000);
const MAX_BODY_BYTES = 64 * 1024;
const RATE_WINDOW_MS = 60_000;
const MAX_PROVIDER_PROBES_PER_WINDOW = 2;
const providerProbeTimes = [];
const envKeys = ["MODEL_ID","MODEL_NAME","OPENAI_MODEL","ANTHROPIC_MODEL","AZURE_OPENAI_DEPLOYMENT","GOOGLE_MODEL","GEMINI_MODEL","IDENTITY_PROBE_MODEL","DECLARED_MODEL_NAME","RUNTIME_DEPLOYMENT_LABEL","OPENAI_BASE_URL"];

const tools = [
  { name: "probe_current_runtime", description: "Read exposed non-secret process metadata; cannot inspect the hidden model serving the MCP client.", inputSchema: { type: "object", properties: {}, additionalProperties: false } },
  { name: "probe_provider_status", description: "Check provider probe configuration without making a network request.", inputSchema: { type: "object", properties: {}, additionalProperties: false } },
  { name: "probe_provider", description: "Make one minimal request to a configured OpenAI-compatible API. Requires operator-configured API credentials, model ID, and probe access token.", inputSchema: { type: "object", properties: { access_token: { type: "string", minLength: 1, maxLength: 512 } }, required: ["access_token"], additionalProperties: false } },
  { name: "compare_identity_claims", description: "Compare claimed model name and provider-returned ID by exact string equality only.", inputSchema: { type: "object", properties: { claimed_name: { type: "string", minLength: 1, maxLength: 200 }, provider_returned_model_id: { type: "string", minLength: 1, maxLength: 200 } }, required: ["claimed_name", "provider_returned_model_id"], additionalProperties: false } }
];

const result = value => ({ content: [{ type: "text", text: JSON.stringify(value, null, 2) }], structuredContent: value });

async function runTool(name, args = {}) {
  if (name === "probe_current_runtime") {
    const exposed = Object.fromEntries(envKeys.filter(key => process.env[key]?.trim()).map(key => [key, process.env[key].trim()]));
    return result({
      status: Object.keys(exposed).length ? "metadata_exposed_unverified" : "identity_not_exposed",
      observed_at: new Date().toISOString(),
      runtime: { node: process.version, platform: process.platform, architecture: process.arch },
      exposed_metadata: exposed,
      limits: ["Labels are not independently verified.", "This service cannot inspect ChatGPT or another client's hidden model state.", "Secret environment variables are never returned."]
    });
  }

  if (name === "probe_provider_status") {
    const providerConfigured = Boolean(process.env.PROBE_API_KEY && process.env.PROBE_MODEL_ID && process.env.PROBE_ACCESS_TOKEN);
    return result({
      status: providerConfigured ? "configured" : "not_configured",
      required_configuration: ["PROBE_API_KEY", "PROBE_MODEL_ID", "PROBE_ACCESS_TOKEN"],
      optional_configuration: ["PROBE_BASE_URL"],
      network_request_made: false,
      note: providerConfigured ? "Provider probe is configured and access-controlled." : "No provider request is possible until all required variables are set."
    });
  }

  if (name === "compare_identity_claims") {
    const claimed = String(args.claimed_name || "").trim();
    const returned = String(args.provider_returned_model_id || "").trim();
    if (!claimed || !returned) return result({ status: "invalid_input", required: ["claimed_name", "provider_returned_model_id"] });
    return result({
      status: claimed === returned ? "exact_string_match" : "mismatch_or_alias",
      claimed_name: claimed,
      provider_returned_model_id: returned,
      conclusion: claimed === returned ? "Strings match exactly; this does not prove the claim came from trusted metadata." : "Strings differ. They may be aliases or different models; equivalence is not inferred.",
      evidence_grade: "string_comparison_only",
      network_request_made: false
    });
  }

  if (name === "probe_provider") {
    const key = process.env.PROBE_API_KEY;
    const model = process.env.PROBE_MODEL_ID;
    const token = process.env.PROBE_ACCESS_TOKEN;
    if (!key || !model || !token) return result({ status: "not_configured", required_configuration: ["PROBE_API_KEY", "PROBE_MODEL_ID", "PROBE_ACCESS_TOKEN"], network_request_made: false });
    if (typeof args.access_token !== "string" || args.access_token.length > 512 || args.access_token !== token) {
      return result({ status: "unauthorized", message: "Valid probe access token required.", network_request_made: false });
    }

    const now = Date.now();
    while (providerProbeTimes.length && now - providerProbeTimes[0] >= RATE_WINDOW_MS) providerProbeTimes.shift();
    if (providerProbeTimes.length >= MAX_PROVIDER_PROBES_PER_WINDOW) {
      return result({ status: "rate_limited", retry_after_seconds: Math.max(1, Math.ceil((RATE_WINDOW_MS - (now - providerProbeTimes[0])) / 1000)), network_request_made: false });
    }
    providerProbeTimes.push(now);

    const base = (process.env.PROBE_BASE_URL || "https://api.openai.com/v1").replace(/\/+$/, "");
    let endpoint;
    try { endpoint = new URL(base); } catch { return result({ status: "configuration_error", message: "PROBE_BASE_URL is invalid; no request made." }); }
    if (endpoint.protocol !== "https:" && endpoint.hostname !== "localhost" && endpoint.hostname !== "127.0.0.1") {
      return result({ status: "configuration_error", message: "HTTPS is required for remote providers; no request made." });
    }

    const started = Date.now();
    let response;
    try {
      response = await fetch(base + "/chat/completions", {
        method: "POST",
        headers: { Authorization: "Bearer " + key, "Content-Type": "application/json" },
        body: JSON.stringify({ model, messages: [{ role: "user", content: "Reply with the single word: OK" }], max_tokens: 3, temperature: 0 }),
        signal: AbortSignal.timeout(20_000)
      });
    } catch (error) {
      return result({ status: "request_failed", error: error?.name === "TimeoutError" ? "Provider request timed out." : "Provider request failed.", elapsed_ms: Date.now() - started, credentials_disclosed: false });
    }

    let data;
    try { data = await response.json(); } catch { data = {}; }
    if (!response.ok) {
      return result({ status: "provider_error", http_status: response.status, error: String(data?.error?.message || "Provider returned an error or non-JSON response.").slice(0, 300), elapsed_ms: Date.now() - started, credentials_disclosed: false });
    }
    const returnedModel = typeof data?.model === "string" ? data.model : null;
    return result({
      status: returnedModel ? "provider_response_metadata_received" : "response_missing_model_id",
      verification: {
        requested_model_id: model,
        returned_model_id: returnedModel,
        provider_endpoint: endpoint.origin + endpoint.pathname,
        https_transport: endpoint.protocol === "https:",
        response_id: typeof data?.id === "string" ? data.id : null,
        system_fingerprint: typeof data?.system_fingerprint === "string" ? data.system_fingerprint : null,
        elapsed_ms: Date.now() - started,
        confidence_scope: returnedModel ? "The endpoint returned this model string for this request; this is not cryptographic proof and does not identify the calling client's hidden model." : "No model ID was returned; identity remains unverified."
      },
      safety: { prompt_contains_sensitive_data: false, request_scope: "one minimal request", credentials_disclosed: false }
    });
  }
  return null;
}

function sendJson(res, status, body) {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer",
    "x-frame-options": "DENY",
    "content-security-policy": "default-src 'none'; frame-ancestors 'none'; base-uri 'none'",
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "access-control-allow-headers": "Content-Type, Accept, MCP-Protocol-Version"
  });
  res.end(JSON.stringify(body));
}

http.createServer(async (req, res) => {
  const path = new URL(req.url, "http://localhost").pathname;
  if (req.method === "OPTIONS") {
    res.writeHead(204, { "access-control-allow-origin": "*", "access-control-allow-methods": "GET, POST, OPTIONS", "access-control-allow-headers": "Content-Type, Accept, MCP-Protocol-Version" });
    return res.end();
  }
  if (path === "/health" && req.method === "GET") return sendJson(res, 200, { name: "model-identity-probe", status: "online", calling_client_identity: "not_observable" });
  if (path === "/" && req.method === "GET") {
    try {
      const html = await readFile(join(dir, "public", "index.html"));
      res.writeHead(200, {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
        "referrer-policy": "no-referrer",
        "x-frame-options": "DENY",
        "content-security-policy": "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'none'"
      });
      return res.end(html);
    } catch {
      return sendJson(res, 500, { error: "Mobile interface unavailable" });
    }
  }
  if (path !== "/api/mcp") return sendJson(res, 404, { error: "Not found" });
  if (req.method === "GET") return sendJson(res, 200, { name: "model-identity-probe", version: "1.0.0", status: "online", mcp_endpoint: "/api/mcp", transport: "stateless JSON-RPC over HTTP" });
  if (req.method !== "POST") return sendJson(res, 405, { error: "Method not allowed" });

  let raw = "";
  for await (const chunk of req) {
    raw += chunk;
    if (Buffer.byteLength(raw, "utf8") > MAX_BODY_BYTES) return sendJson(res, 413, { error: "Request too large" });
  }
  let body;
  try { body = JSON.parse(raw); } catch { return sendJson(res, 400, { jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }); }

  const id = body.id ?? null;
  const send = (payload, status = 200) => sendJson(res, status, { jsonrpc: "2.0", id, ...payload });
  if (body.jsonrpc !== "2.0" || typeof body.method !== "string") return send({ error: { code: -32600, message: "Invalid JSON-RPC request" } }, 400);
  if (body.method.startsWith("notifications/")) { res.writeHead(202, { "cache-control": "no-store" }); return res.end(); }
  if (body.method === "initialize") return send({ result: { protocolVersion: body.params?.protocolVersion || "2025-03-26", capabilities: { tools: {} }, serverInfo: { name: "model-identity-probe", version: "1.0.0" } } });
  if (body.method === "ping") return send({ result: {} });
  if (body.method === "tools/list") return send({ result: { tools } });
  if (body.method === "tools/call") {
    try {
      const output = await runTool(body.params?.name, body.params?.arguments || {});
      return output ? send({ result: output }) : send({ error: { code: -32602, message: "Unknown tool" } }, 400);
    } catch {
      return send({ error: { code: -32603, message: "Internal probe error; sensitive details omitted" } }, 500);
    }
  }
  return send({ error: { code: -32601, message: "Method not found" } }, 404);
}).listen(port, "0.0.0.0", () => console.log("Model Identity Probe listening on " + port));
