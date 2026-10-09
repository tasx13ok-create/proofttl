import http from "node:http";
import { timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const dir = dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT || 3000);
const MAX_BODY_BYTES = 64 * 1024;
const RATE_WINDOW_MS = 60_000;
const MAX_PROVIDER_PROBES_PER_WINDOW = 2;
const providerProbeTimes = [];
const envKeys = ["MODEL_ID","MODEL_NAME","OPENAI_MODEL","ANTHROPIC_MODEL","AZURE_OPENAI_DEPLOYMENT","GOOGLE_MODEL","GEMINI_MODEL","IDENTITY_PROBE_MODEL","DECLARED_MODEL_NAME","RUNTIME_DEPLOYMENT_LABEL"];

const tools = [
  { name: "probe_current_runtime", description: "Read exposed non-secret process metadata; cannot inspect the hidden model serving the MCP client.", inputSchema: { type: "object", properties: {}, additionalProperties: false } },
  { name: "probe_provider_status", description: "Check provider probe configuration without making a network request.", inputSchema: { type: "object", properties: {}, additionalProperties: false } },
  { name: "probe_provider", description: "Make one minimal request using the configured OpenAI, OpenRouter, Anthropic, Gemini, Vertex AI, Azure OpenAI, Amazon Bedrock, Cohere, or OpenAI-compatible provider adapter. Requires operator-configured credentials, model ID, and probe access token.", inputSchema: { type: "object", properties: { access_token: { type: "string", minLength: 1, maxLength: 512 } }, required: ["access_token"], additionalProperties: false } },
  { name: "compare_identity_claims", description: "Compare claimed model name and provider-returned ID by exact string equality only.", inputSchema: { type: "object", properties: { claimed_name: { type: "string", minLength: 1, maxLength: 200 }, provider_returned_model_id: { type: "string", minLength: 1, maxLength: 200 } }, required: ["claimed_name", "provider_returned_model_id"], additionalProperties: false } }
];

const result = value => ({ content: [{ type: "text", text: JSON.stringify(value, null, 2) }], structuredContent: value });
const MIN_ACCESS_TOKEN_LENGTH = 32;
function matchesAccessToken(provided, expected) {
  if (typeof provided !== "string" || typeof expected !== "string") return false;
  const candidate = Buffer.from(provided, "utf8");
  const configured = Buffer.from(expected, "utf8");
  return candidate.length === configured.length && timingSafeEqual(candidate, configured);
}

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
    const key = process.env.PROBE_API_KEY;
    const model = process.env.PROBE_MODEL_ID;
    const token = process.env.PROBE_ACCESS_TOKEN;
    const hasCoreConfig = Boolean(key && model && token);
    const tokenStrongEnough = Boolean(token && Buffer.byteLength(token, "utf8") >= MIN_ACCESS_TOKEN_LENGTH);
    const provider = (process.env.PROBE_PROVIDER || "openai-compatible").toLowerCase();
    const supportedProviders = ["openai", "openai-compatible", "openrouter", "anthropic", "gemini", "azure-openai", "xai", "deepseek", "mistral", "groq", "together", "fireworks", "perplexity", "bedrock", "vertex-ai", "cohere"];
    const providerSupported = supportedProviders.includes(provider);
    const requiresBaseUrl = provider === "azure-openai" || provider === "vertex-ai";
    const hasRequiredBaseUrl = !requiresBaseUrl || Boolean(process.env.PROBE_BASE_URL);
    const providerConfigured = hasCoreConfig && tokenStrongEnough && providerSupported && hasRequiredBaseUrl;
    const invalidReason = !providerSupported
      ? "PROBE_PROVIDER is unsupported."
      : hasCoreConfig && !tokenStrongEnough
        ? "PROBE_ACCESS_TOKEN must be at least 32 UTF-8 bytes."
        : hasCoreConfig && !hasRequiredBaseUrl
          ? "PROBE_BASE_URL is required for this provider."
          : null;
    return result({
      status: providerConfigured ? "configured" : hasCoreConfig ? "invalid_configuration" : "not_configured",
      required_configuration: ["PROBE_API_KEY", "PROBE_MODEL_ID", "PROBE_ACCESS_TOKEN", ...(requiresBaseUrl ? ["PROBE_BASE_URL"] : [])],
      provider,
      supported_providers: supportedProviders,
      access_token_minimum_length: MIN_ACCESS_TOKEN_LENGTH,
      optional_configuration: [...(requiresBaseUrl ? [] : ["PROBE_BASE_URL"]), "PROBE_API_VERSION", "PROBE_ANTHROPIC_VERSION", "AWS_REGION"],
      network_request_made: false,
      note: providerConfigured ? "Provider probe is configured and access-controlled." : invalidReason || "No provider request is possible until all required variables are set."
    });
  }

  if (name === "compare_identity_claims") {
    const claimed = typeof args.claimed_name === "string" ? args.claimed_name.trim() : "";
    const returned = typeof args.provider_returned_model_id === "string" ? args.provider_returned_model_id.trim() : "";
    if (!claimed || !returned) return result({ status: "invalid_input", required: ["claimed_name", "provider_returned_model_id"], note: "Both values must be non-empty strings." });
    if (claimed.length > 200 || returned.length > 200) return result({ status: "invalid_input", maximum_length: 200, network_request_made: false });
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
    const provider = (process.env.PROBE_PROVIDER || "openai-compatible").toLowerCase();
    const supported = ["openai", "openai-compatible", "openrouter", "anthropic", "gemini", "azure-openai", "xai", "deepseek", "mistral", "groq", "together", "fireworks", "perplexity", "bedrock", "vertex-ai", "cohere"];
    if (!supported.includes(provider)) return result({ status: "unsupported_provider", supported_providers: supported, network_request_made: false });
    if (!key || !model || !token) return result({ status: "not_configured", required_configuration: ["PROBE_API_KEY", "PROBE_MODEL_ID", "PROBE_ACCESS_TOKEN"], network_request_made: false });
    if (Buffer.byteLength(token, "utf8") < MIN_ACCESS_TOKEN_LENGTH) return result({ status: "invalid_configuration", message: "PROBE_ACCESS_TOKEN must be at least 32 UTF-8 bytes; no provider request made.", network_request_made: false });
    if (typeof args.access_token !== "string" || Buffer.byteLength(args.access_token, "utf8") > 512 || !matchesAccessToken(args.access_token, token)) {
      return result({ status: "unauthorized", message: "Valid probe access token required.", network_request_made: false });
    }

    const now = Date.now();
    while (providerProbeTimes.length && now - providerProbeTimes[0] >= RATE_WINDOW_MS) providerProbeTimes.shift();
    if (providerProbeTimes.length >= MAX_PROVIDER_PROBES_PER_WINDOW) {
      return result({ status: "rate_limited", retry_after_seconds: Math.max(1, Math.ceil((RATE_WINDOW_MS - (now - providerProbeTimes[0])) / 1000)), network_request_made: false });
    }

    const defaults = {
      openai: "https://api.openai.com/v1",
      "openai-compatible": "https://api.openai.com/v1",
      openrouter: "https://openrouter.ai/api/v1",
      xai: "https://api.x.ai/v1",
      deepseek: "https://api.deepseek.com",
      mistral: "https://api.mistral.ai/v1",
      groq: "https://api.groq.com/openai/v1",
      together: "https://api.together.xyz/v1",
      fireworks: "https://api.fireworks.ai/inference/v1",
      perplexity: "https://api.perplexity.ai",
      bedrock: "https://bedrock-runtime." + (process.env.AWS_REGION || "us-east-1") + ".amazonaws.com/openai/v1",
      cohere: "https://api.cohere.com/v2",
      "vertex-ai": "",
      anthropic: "https://api.anthropic.com",
      gemini: "https://generativelanguage.googleapis.com/v1beta",
      "azure-openai": ""
    };
    const base = (process.env.PROBE_BASE_URL || defaults[provider] || "").replace(/\/+$/, "");
    if (!base) return result({ status: "configuration_error", message: "PROBE_BASE_URL is required for Azure OpenAI or Vertex AI and must identify the resource/deployment/model base URL.", network_request_made: false });
    let endpoint;
    try { endpoint = new URL(base); } catch { return result({ status: "configuration_error", message: "PROBE_BASE_URL is invalid; no request made.", network_request_made: false }); }
    if (endpoint.protocol !== "https:" && endpoint.hostname !== "localhost" && endpoint.hostname !== "127.0.0.1") {
      return result({ status: "configuration_error", message: "HTTPS is required for remote providers; no request made.", network_request_made: false });
    }
    if (endpoint.username || endpoint.password || endpoint.search || endpoint.hash) {
      return result({ status: "configuration_error", message: "PROBE_BASE_URL must not contain credentials, query parameters, or a fragment; no request made.", network_request_made: false });
    }

    let url;
    let headers = { "Content-Type": "application/json" };
    let payload;
    if (provider === "anthropic") {
      url = base + "/v1/messages";
      headers["x-api-key"] = key;
      headers["anthropic-version"] = process.env.PROBE_ANTHROPIC_VERSION || "2023-06-01";
      payload = { model, max_tokens: 4, messages: [{ role: "user", content: "Reply with the single word: OK" }] };
    } else if (provider === "gemini") {
      url = base + "/models/" + encodeURIComponent(model.replace(/^models\//, "")) + ":generateContent?key=" + encodeURIComponent(key);
      payload = { contents: [{ parts: [{ text: "Reply with the single word: OK" }] }], generationConfig: { maxOutputTokens: 4, temperature: 0 } };
    } else if (provider === "vertex-ai") {
      url = base + "/" + encodeURIComponent(model.replace(/^models\//, "")) + ":generateContent";
      headers.Authorization = "Bearer " + key;
      payload = { contents: [{ parts: [{ text: "Reply with the single word: OK" }] }], generationConfig: { maxOutputTokens: 4, temperature: 0 } };
    } else if (provider === "cohere") {
      url = base + "/chat";
      headers.Authorization = "Bearer " + key;
      payload = { model, messages: [{ role: "user", content: "Reply with the single word: OK" }], max_tokens: 4 };
    } else if (provider === "azure-openai") {
      const apiVersion = process.env.PROBE_API_VERSION || "2024-10-21";
      url = base + "/chat/completions?api-version=" + encodeURIComponent(apiVersion);
      headers["api-key"] = key;
      payload = { messages: [{ role: "user", content: "Reply with the single word: OK" }], max_tokens: 4, temperature: 0 };
    } else {
      url = base + "/chat/completions";
      headers.Authorization = "Bearer " + key;
      payload = { model, messages: [{ role: "user", content: "Reply with the single word: OK" }], max_tokens: 4, temperature: 0 };
    }

    const started = Date.now();
    let response;
    try {
      response = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
        redirect: "error",
        signal: AbortSignal.timeout(20_000)
      });
    } catch (error) {
      return result({ status: "request_failed", provider, error: error?.name === "TimeoutError" ? "Provider request timed out." : "Provider request failed.", elapsed_ms: Date.now() - started, credentials_disclosed: false, network_request_made: true });
    }

    let data;
    try { data = await response.json(); } catch { data = {}; }
    if (!response.ok) {
      const providerMessage = data?.error?.message || data?.error?.type || data?.message || "Provider returned an error or non-JSON response.";
      return result({ status: "provider_error", provider, http_status: response.status, error: String(providerMessage).replaceAll(key, "[redacted]").replaceAll(token, "[redacted]").slice(0, 300), elapsed_ms: Date.now() - started, credentials_disclosed: false, network_request_made: true });
    }
    const returnedModel = provider === "gemini" || provider === "vertex-ai"
      ? (typeof data?.modelVersion === "string" ? data.modelVersion : null)
      : (typeof data?.model === "string" ? data.model : null);
    const responseId = typeof data?.id === "string" ? data.id : (typeof data?.responseId === "string" ? data.responseId : null);
    const systemFingerprint = typeof data?.system_fingerprint === "string" ? data.system_fingerprint : null;
    return result({
      status: returnedModel ? "provider_response_metadata_received" : "response_missing_model_id",
      verification: {
        provider,
        requested_model_id: model,
        returned_model_id: returnedModel,
        provider_endpoint: endpoint.origin + endpoint.pathname,
        https_transport: endpoint.protocol === "https:",
        response_id: responseId,
        system_fingerprint: systemFingerprint,
        elapsed_ms: Date.now() - started,
        evidence_grade: returnedModel ? "provider_returned_request_metadata" : "no_returned_model_identifier",
        confidence_scope: returnedModel ? "The provider endpoint returned this model identifier/version for this specific request. This is evidence from that endpoint, not cryptographic proof and not the hidden model used by another client." : "The response did not include a model identifier; identity remains unverified."
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
  const assets = {
    "/app.js": { file: "app.js", type: "text/javascript; charset=utf-8" },
    "/styles.css": { file: "styles.css", type: "text/css; charset=utf-8" },
    "/manifest.webmanifest": { file: "manifest.webmanifest", type: "application/manifest+json; charset=utf-8" },
    "/icon.svg": { file: "icon.svg", type: "image/svg+xml; charset=utf-8" }
  };
  if (assets[path] && req.method === "GET") {
    try {
      const asset = await readFile(join(dir, "public", assets[path].file));
      res.writeHead(200, {
        "content-type": assets[path].type,
        "cache-control": path === "/manifest.webmanifest" ? "no-cache" : "public, max-age=300",
        "x-content-type-options": "nosniff",
        "referrer-policy": "no-referrer",
        "x-frame-options": "DENY",
        "content-security-policy": "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; frame-ancestors 'none'; base-uri 'none'"
      });
      return res.end(asset);
    } catch {
      return sendJson(res, 404, { error: "Asset not found" });
    }
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
        "content-security-policy": "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'"
      });
      return res.end(html);
    } catch {
      return sendJson(res, 500, { error: "Mobile interface unavailable" });
    }
  }
  if (path !== "/api/mcp") return sendJson(res, 404, { error: "Not found" });
  if (req.method === "GET") {
    res.writeHead(405, {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "allow": "POST, OPTIONS",
      "x-content-type-options": "nosniff",
      "referrer-policy": "no-referrer",
      "x-frame-options": "DENY",
      "content-security-policy": "default-src 'none'; frame-ancestors 'none'; base-uri 'none'",
      "access-control-allow-origin": "*"
    });
    return res.end(JSON.stringify({ error: "GET-based SSE is not supported; use POST for Streamable HTTP JSON-RPC." }));
  }
  if (req.method !== "POST") return sendJson(res, 405, { error: "Method not allowed" });

  let raw = "";
  for await (const chunk of req) {
    raw += chunk;
    if (Buffer.byteLength(raw, "utf8") > MAX_BODY_BYTES) return sendJson(res, 413, { error: "Request too large" });
  }
  let body;
  try { body = JSON.parse(raw); } catch { return sendJson(res, 400, { jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }); }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return sendJson(res, 400, { jsonrpc: "2.0", id: null, error: { code: -32600, message: "Invalid JSON-RPC request" } });
  }

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
