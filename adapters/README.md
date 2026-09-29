# Thin provider adapters

`mcp-client.js` uses the official MCP SDK's Streamable HTTP client. `function-calling.js` copies discovered server schemas into function descriptors and forwards function calls/results. Neither module extracts claims, fetches evidence, sets verdicts, decides lease eligibility, signs artifacts, or substitutes another tenant.

Provide an authorized HTTPS preview endpoint and tenant bearer credential explicitly. Credentials do not belong in prompts, descriptors, URLs, source records, logs, plugin manifests, or git. Redirects and cross-origin credential forwarding are rejected. Cancellation signals and request timeouts pass to the SDK; an uncertain issuance outcome must be retried with identical arguments and the same idempotency key.

Example integration:
```js
import { connectProofTTL } from "./mcp-client.js";
import { createFunctionCallingAdapter } from "./function-calling.js";

const mcp = await connectProofTTL({
  url: process.env.PROOFTTL_MCP_URL,
  bearerToken: process.env.PROOFTTL_MCP_BEARER_TOKEN
});
try {
  const adapter = createFunctionCallingAdapter(mcp);
  const tools = await adapter.tools();
  // Supply tools to the host's function-calling API.
  // Keep the assistant's original tool_calls message in that API conversation.
  // For each selected canonical call, append this tool response unchanged:
  // const result = await adapter.executeDeepSeekToolCall(toolCall);
} finally {
  await mcp.close();
}
```

The application controls which calls are authorized by the user's request. Source/tool narratives remain untrusted data. Do not auto-mint merely because a model generated a lease function call. DeepSeek's strict schema mode is deliberately unset until tested against the discovered schemas and the actual API.

Cloud checks: `node scripts/provider-contract-test.js` exercises the actual MCP handler and canonical service in process; `node scripts/provider-plugin-test.js` validates package metadata against official schemas. These are adapter/package checks, not real-host compatibility certification.

`node scripts/provider-preview-smoke.js` tests a configured deployed preview. It lists tools by default; `--audit` also writes a disposable customer-only text audit. No production endpoint is accepted and no lease is issued by this probe. Missing credentials produce NOT TESTED with a nonzero exit code. No credentials are printed.
