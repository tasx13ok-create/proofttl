import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { handleMcpRequest } from "../src/mcp/handler.js";
import { createMcpTestEnv, createMcpTestToken } from "./mcp-test-helpers.js";
import { connectProofTTL, CANONICAL_TOOL_NAMES } from "../adapters/mcp-client.js";
import { createFunctionCallingAdapter, toFunctionTools } from "../adapters/function-calling.js";

let checks = 0;
function check(condition, message) { assert.ok(condition, message); checks++; }
async function failSafely(operation) {
  let result;
  try { result = await operation(); }
  catch (error) { check(error instanceof Error, "errors remain errors"); return; }
  check(result?.isError === true, "invalid tool request must fail");
  check(!result?.structuredContent?.lease_id, "failed request must not mint a lease");
}
const fixture = await createMcpTestEnv();
const requests = [];
const inProcessFetch = async (input, init) => {
  const request = new Request(input, init);
  requests.push({ method: request.method, authorizationPresent: request.headers.has("authorization") });
  return handleMcpRequest(request, fixture.env);
};
const mcp = await connectProofTTL({
  url: "https://proofttl-contract.example.invalid/mcp",
  bearerToken: fixture.token, fetchImpl: inProcessFetch
});
let other;
try {
  const catalog = await mcp.listTools();
  assert.deepEqual(catalog.map(tool => tool.name).sort(), [...CANONICAL_TOOL_NAMES].sort()); checks++;
  const adapter = createFunctionCallingAdapter(mcp);
  const descriptors = await adapter.tools();
  for (const tool of catalog) {
    const descriptor = descriptors.find(item => item.function.name === tool.name);
    assert.deepEqual(descriptor.function.parameters, tool.inputSchema); checks++;
    check(!Object.hasOwn(descriptor.function, "strict"), "uncertified provider strict mode stays unset");
  }
  const claim = "The project codename is Orion.";
  const args = { claim, sources: [{ kind: "text", text: claim, label: "Customer contract fixture" }], source_policy: "customer_only" };
  const message = await adapter.executeDeepSeekToolCall({
    id: "deepseek_fixture_1", type: "function",
    function: { name: "audit_claim", arguments: JSON.stringify(args) }
  });
  check(message.role === "tool" && message.tool_call_id === "deepseek_fixture_1", "DeepSeek envelope pairing");
  const auditResult = JSON.parse(message.content);
  check(auditResult.isError !== true, "actual canonical audit succeeds");
  const audit = auditResult.structuredContent;
  check(audit.verdict === "SUPPORTED" && audit.lease_eligible === true, "actual guarded exact result");
  check(audit.outside_evidence_used === false && audit.public_discovery === "NOT SUPPORTED", "customer-only boundary");
  check(audit.evidence.every(span => span.source_id && span.sha256 && span.source_sha256), "attributable evidence");
  const ids = { audit_id: audit.audit_id, claim_result_id: audit.claim_result_id };
  const challenged = await adapter.executeFunctionCall("challenge_claim", JSON.stringify(ids));
  check(challenged.structuredContent.audit_mutated === false, "challenge does not rewrite immutable audit");
  const compared = await adapter.executeFunctionCall("compare_evidence", JSON.stringify(ids));
  check(compared.structuredContent.claim_results.length === 1, "comparison uses authoritative audit");
  const output = await adapter.executeFunctionCall("audit_output", JSON.stringify({
    output_text: claim, sources: args.sources, source_policy: "customer_only", max_claims: 1
  }));
  check(output.structuredContent.claim_results.length === 1, "output audit uses same service");
  check(output.structuredContent.extraction.recall === "NOT PROVEN", "extraction limitations are preserved");
  const leaseArgs = { ...ids, ttl_seconds: 300, idempotency_key: "provider-contract-" + randomUUID() };
  const issued = await Promise.all([
    adapter.executeFunctionCall("create_fact_lease", JSON.stringify(leaseArgs)),
    adapter.executeFunctionCall("create_fact_lease", JSON.stringify(leaseArgs))
  ]);
  check(issued.every(result => result.isError !== true), "concurrent issuance succeeds");
  const lease = issued[0].structuredContent;
  check(lease.lease_id === issued[1].structuredContent.lease_id, "idempotent concurrent calls return one lease");
  check(lease.audit_id === audit.audit_id && lease.claim_result_id === audit.claim_result_id, "audit-to-lease binding");
  check(lease.monitoring.status === "NOT_REGISTERED" && lease.current_status_basis === "IMMUTABLE_SNAPSHOT", "no invented live monitoring");
  const read = await adapter.executeFunctionCall("get_fact_lease", JSON.stringify({ lease_id: lease.lease_id }));
  check(read.structuredContent.lease_id === lease.lease_id && read.structuredContent.signature_verified === true, "actual canonical lease read");
  await failSafely(() => adapter.executeFunctionCall("create_fact_lease", JSON.stringify({ ...leaseArgs, verdict: "SUPPORTED" })));
  await failSafely(() => adapter.executeFunctionCall("create_fact_lease", JSON.stringify({ ...leaseArgs, ttl_seconds: 301 })));
  const file = await adapter.executeFunctionCall("audit_claim", JSON.stringify({
    claim, source_policy: "customer_only",
    sources: [{ kind: "file", mime_type: "text/plain", filename: "evidence.txt", content_base64: Buffer.from(claim, "utf8").toString("base64") }]
  }));
  check(file.structuredContent.verdict === "SUPPORTED", "authorized text/plain byte snapshot works");
  await failSafely(() => adapter.executeFunctionCall("audit_claim", JSON.stringify({
    claim, source_policy: "customer_only",
    sources: [{ kind: "file", mime_type: "application/pdf", content_base64: Buffer.from(claim).toString("base64") }]
  })));
  const unknown = await adapter.executeFunctionCall("audit_claim", JSON.stringify({ ...args, sources: [] }));
  check(unknown.structuredContent.verdict === "UNKNOWN" && !unknown.structuredContent.lease_eligible, "missing evidence is preserved");
  await assert.rejects(() => adapter.executeFunctionCall("audit_claim", "{"), { code: "malformed_function_arguments" }); checks++;
  await assert.rejects(() => adapter.executeFunctionCall("audit_claim", "null"), { code: "arguments_must_be_object" }); checks++;
  await assert.rejects(() => adapter.executeFunctionCall("owner_desk", "{}"), { code: "tool_not_allowlisted" }); checks++;
  await assert.rejects(() => adapter.executeDeepSeekToolCall({ id: "x", type: "function", function: { name: "audit_claim", arguments: [] } }), { code: "invalid_function_arguments" }); checks++;
  const secondToken = await createMcpTestToken(fixture.env, { sub: "provider_other_tenant" });
  other = await connectProofTTL({ url: "https://proofttl-contract.example.invalid/mcp", bearerToken: secondToken, fetchImpl: inProcessFetch });
  const denied = await other.callTool("get_fact_lease", { lease_id: lease.lease_id });
  check(denied.isError === true && !denied.structuredContent?.sources, "cross-tenant lease access is denied");
  await assert.rejects(() => connectProofTTL({ url: "http://preview.example/mcp", bearerToken: fixture.token }), { code: "https_mcp_url_required" }); checks++;
  await assert.rejects(() => connectProofTTL({ url: "https://proofttl-preview.example.invalid/mcp", bearerToken: fixture.token }), { code: "configure_preview_endpoint" }); checks++;
  await assert.rejects(() => connectProofTTL({ url: "https://proofttl-contract.example.invalid/mcp", bearerToken: "invalid", fetchImpl: inProcessFetch })); checks++;
  check(requests.length > 10 && requests.every(request => request.authorizationPresent), "bearer accompanies every transport request");
  const original = { content: [{ type: "text", text: "untrusted source narrative" }], structuredContent: { verdict: "UNKNOWN" }, isError: true, _meta: { note: "keep" } };
  const forwarding = createFunctionCallingAdapter({ listTools: async () => catalog, callTool: async () => original });
  const forwarded = await forwarding.executeDeepSeekToolCall({ id: "exact_result", type: "function", function: { name: "audit_claim", arguments: JSON.stringify(args) } });
  assert.deepEqual(JSON.parse(forwarded.content), original); checks++;
  assert.throws(() => toFunctionTools(catalog.filter(tool => tool.name !== "get_fact_lease")), { code: "incomplete_canonical_tool_catalog" }); checks++;
  console.log(JSON.stringify({ suite: "provider-adapter-contract", status: "PASS", checks, execution: "actual canonical handler and service, in-process cloud test", real_provider_hosts: "NOT TESTED", model_api_calls: 0 }));
} finally {
  await other?.close();
  await mcp.close();
  await fixture.close();
}
