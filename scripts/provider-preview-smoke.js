import { connectProofTTL, CANONICAL_TOOL_NAMES } from "../adapters/mcp-client.js";

const url = process.env.PROOFTTL_MCP_URL;
const bearerToken = process.env.PROOFTTL_MCP_BEARER_TOKEN;
if (!url || !bearerToken) {
  console.log(JSON.stringify({ suite: "provider-preview", status: "NOT TESTED", reason: "preview endpoint and tenant bearer credential are required" }));
  process.exitCode = 2;
} else {
  const endpoint = new URL(url);
  if (endpoint.hostname === "proofttl.tasx13ok.workers.dev") throw new Error("production_endpoint_not_allowed");
  const mcp = await connectProofTTL({ url, bearerToken });
  try {
    const catalog = await mcp.listTools();
    if (CANONICAL_TOOL_NAMES.some(name => !catalog.some(tool => tool.name === name))) {
      throw new Error("incomplete_canonical_tool_catalog");
    }
    let auditStatus = "NOT TESTED";
    if (process.argv.includes("--audit")) {
      const claim = "The project codename is Orion.";
      const result = await mcp.callTool("audit_claim", {
        claim, sources: [{ kind: "text", text: claim }], source_policy: "customer_only"
      });
      if (result.isError || result.structuredContent?.verdict !== "SUPPORTED" ||
          result.structuredContent?.outside_evidence_used !== false) {
        throw new Error("preview_audit_failed");
      }
      auditStatus = "PASS";
    }
    console.log(JSON.stringify({ suite: "provider-preview", status: "PASS", discovery: "PASS", audit: auditStatus, lease_issuance: "NOT TESTED", real_provider_hosts: "NOT TESTED", scope: "authorized deployed preview only" }));
  } finally { await mcp.close(); }
}
