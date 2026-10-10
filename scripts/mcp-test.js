import assert from "node:assert/strict";
import { handleProofTTLMcp, PROOFTTL_MCP_TOOLS } from "../src/mcp.js";

const originalFetch = globalThis.fetch;
let lastRequest = null;
globalThis.fetch = async (input, init = {}) => {
  lastRequest = { url: String(input), init };
  if (String(input).endsWith("/health")) return Response.json({ ok: true, service: "proofttl" });
  if (String(input).endsWith("/verify")) return Response.json({ error: "payment_required" }, { status: 402, headers: { "payment-required": "test-challenge" } });
  if (String(input).endsWith("/assistant/text")) return Response.json({ response: "ProofTTL assistant response" });
  if (String(input).includes("/lease/")) return Response.json({ error: "lease_not_found" }, { status: 404 });
  return Response.json({ ok: true });
};
async function rpc(method, params = {}, id = 1) {
  const request = new Request("https://unit.test/mcp", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id, method, params }) });
  return await (await handleProofTTLMcp(request)).json();
}
try {
  const discovery = await (await handleProofTTLMcp(new Request("https://unit.test/mcp"))).json();
  assert.equal(discovery.service, "ProofTTL MCP");
  const initialized = await rpc("initialize");
  assert.equal(initialized.result.serverInfo.name, "proofttl-mcp");
  const listed = await rpc("tools/list");
  assert.equal(listed.result.tools.length, 7);
  assert.equal(PROOFTTL_MCP_TOOLS.length, 7);
  const health = await rpc("tools/call", { name: "proofttl_health", arguments: {} });
  assert.match(health.result.content[0].text, /"ok": true/);
  assert.match(lastRequest.url, /\/health$/);
  const invalidLease = await rpc("tools/call", { name: "proofttl_get_lease", arguments: { lease_id: "../../etc/passwd" } });
  assert.equal(invalidLease.result.isError, true);
  const assistant = await rpc("tools/call", { name: "proofttl_ask_assistant", arguments: { message: "What is ProofTTL?" } });
  assert.match(assistant.result.content[0].text, /not a formal verification verdict/);
  const verify = await rpc("tools/call", { name: "proofttl_verify_claim", arguments: { claim: "A claim", source_url: "https://example.com" } });
  const verifyText = verify.result.content[0].text;
  assert.match(verifyText, /payment_required/);
  assert.match(verifyText, /No payment was sent/);
  assert.equal(lastRequest.init.method, "POST");
  const badSource = await rpc("tools/call", { name: "proofttl_verify_claim", arguments: { claim: "A claim", source_url: "file:///etc/passwd" } });
  assert.equal(badSource.result.isError, true);
  console.log("ProofTTL MCP tests passed: initialize, discovery, tools/list, health proxy, lease ID validation, assistant boundary, payment-safe verify, URL validation.");
} finally {
  globalThis.fetch = originalFetch;
}
