import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

export const CANONICAL_TOOL_NAMES = Object.freeze([
  "audit_claim", "audit_output", "challenge_claim", "compare_evidence",
  "create_fact_lease", "get_fact_lease"
]);

export class AdapterInputError extends Error {
  constructor(code) { super(code); this.name = "AdapterInputError"; this.code = code; }
}

export function requireToolArguments(name, args) {
  if (!CANONICAL_TOOL_NAMES.includes(name)) throw new AdapterInputError("tool_not_allowlisted");
  if (!args || typeof args !== "object" || Array.isArray(args) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(args))) {
    throw new AdapterInputError("arguments_must_be_object");
  }
}

// This transport forwards the canonical service contract; it makes no verdicts.
export async function connectProofTTL({ url, bearerToken, fetchImpl, timeoutMs = 15000 } = {}) {
  let endpoint;
  try { endpoint = new URL(url); } catch { throw new AdapterInputError("invalid_mcp_url"); }
  if (endpoint.protocol !== "https:" || endpoint.username || endpoint.password ||
      endpoint.hash || endpoint.search) throw new AdapterInputError("https_mcp_url_required");
  if (endpoint.hostname.endsWith(".invalid") && !fetchImpl) {
    throw new AdapterInputError("configure_preview_endpoint");
  }
  if (typeof bearerToken !== "string" || !bearerToken || bearerToken.length > 16384 ||
      /\s/.test(bearerToken)) throw new AdapterInputError("bearer_token_required");
  if (!Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 120000) {
    throw new AdapterInputError("invalid_timeout");
  }
  const requestFetch = fetchImpl || globalThis.fetch;
  if (typeof requestFetch !== "function") throw new AdapterInputError("fetch_required");
  const guardedFetch = async (input, init = {}) => {
    const target = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
    if (target.origin !== endpoint.origin) throw new AdapterInputError("cross_origin_mcp_request");
    // Never forward tenant bearer credentials through a redirect.
    return requestFetch(input, { ...init, redirect: "error" });
  };
  const client = new Client({ name: "proofttl-provider-adapter", version: "0.1.0" }, { capabilities: {} });
  const transport = new StreamableHTTPClientTransport(endpoint, {
    requestInit: { headers: { Authorization: "Bearer " + bearerToken } },
    fetch: guardedFetch
  });
  try { await client.connect(transport, { timeout: timeoutMs }); }
  catch (error) { await client.close().catch(() => {}); throw error; }
  return {
    async listTools({ signal } = {}) {
      const tools = []; const cursors = new Set(); let cursor;
      for (let page = 0; page < 100; page++) {
        const result = await client.listTools(cursor ? { cursor } : {}, { timeout: timeoutMs, signal });
        tools.push(...result.tools);
        if (!result.nextCursor) return tools;
        if (cursors.has(result.nextCursor)) throw new AdapterInputError("repeated_tools_cursor");
        cursors.add(result.nextCursor); cursor = result.nextCursor;
      }
      throw new AdapterInputError("tool_catalog_too_large");
    },
    async callTool(name, args, { signal } = {}) {
      requireToolArguments(name, args);
      // SDK validates protocol results. Server validates input schema and trust policy.
      return client.callTool({ name, arguments: args }, undefined, { timeout: timeoutMs, signal });
    },
    async close() { await client.close(); }
  };
}
