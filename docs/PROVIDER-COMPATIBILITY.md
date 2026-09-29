# Provider compatibility

Updated: 2026-09-29. One canonical service and six MCP tools; no provider-specific verifier. Documentation establishes a possible integration surface, not an executed compatibility result.

## Evidence matrix

PASS may be recorded only after execution, with commit, date, client/version, endpoint environment and a safe evidence/run link. In-process SDK tests and model-shaped fixtures are not consumer-host tests. No production endpoint is certified.

| Host/path | Discovery | Tool call | Auth | Structured result | UI | File-source path |
| --- | --- | --- | --- | --- | --- | --- |
| ChatGPT plugin | NOT TESTED | NOT TESTED | NOT TESTED | NOT TESTED | NOT TESTED | NOT TESTED |
| Codex remote MCP | NOT TESTED | NOT TESTED | NOT TESTED | NOT TESTED | NOT TESTED | NOT TESTED |
| Claude remote MCP | NOT TESTED | NOT TESTED | NOT TESTED | NOT TESTED | NOT TESTED | NOT TESTED |
| Grok custom connector | NOT TESTED | NOT TESTED | NOT TESTED | NOT TESTED | NOT TESTED | NOT TESTED |
| Gemini Interactions remote MCP | NOT TESTED | NOT TESTED | NOT TESTED | NOT TESTED | NOT TESTED | NOT TESTED |
| Copilot Studio MCP | NOT TESTED | NOT TESTED | NOT TESTED | NOT TESTED | NOT TESTED | NOT TESTED |
| Cursor remote MCP | NOT TESTED | NOT TESTED | NOT TESTED | NOT TESTED | NOT TESTED | NOT TESTED |
| DeepSeek function adapter, actual API | NOT TESTED | NOT TESTED | NOT TESTED | NOT TESTED | NOT TESTED | NOT TESTED |
| Generic SDK/function adapter, cloud contract | PASS: 2304d36 | PASS: 2304d36 | PASS: 2304d36 | PASS: 2304d36 | PENDING CI | PASS: 2304d36 |

Headless adapter and package checks passed at commit `2304d36d1bd8986c703c42cba36836782d71e09b`, [cloud run 36639914640](https://github.com/tasx13ok-create/proofttl/actions/runs/36639914640). These calls used the actual in-process MCP service with disposable SQLite D1 and no provider model API or consumer host. Subsequent Apps/145-case/temporal changes await later evidence.

Machine-readable status lives in [provider-compatibility.json](../specs/provider-compatibility.json). Record cloud contract results separately from real hosts. The unchanged-base [cloud run 36638369822](https://github.com/tasx13ok-create/proofttl/actions/runs/36638369822) covers legacy tests/dry run only.

## Documented extension surfaces

| Host | Official surface and practical gate |
| --- | --- |
| ChatGPT | Portable plugin with Skills plus remote MCP; optional MCP Apps. Package endpoint is a reserved cloud-preview placeholder. Private account linking requires the documented OAuth resource/authorization flow, which draft tenant bearer authentication does not supply. [Packaging](https://developers.openai.com/plugins/build/plugins), [authentication](https://developers.openai.com/plugins/build/auth) |
| Codex | Remote Streamable HTTP MCP with host-managed authentication. Never place bearer material in the portable package; configure credentials through the host's supported mechanism. No machine configuration was installed for this task. [Official MCP documentation](https://developers.openai.com/codex/mcp) |
| Claude | Messages API remote MCP connector supports publicly reachable HTTPS Streamable HTTP and bearer authorization; toolset configuration controls enabled tools. The current documented connector beta is `mcp-client-2025-11-20`. It currently describes tool calls, not equivalent UI or attachment transfer. [MCP connector](https://platform.claude.com/docs/en/agents-and-tools/mcp-connector) |
| Grok | Custom MCP connector takes a public server URL and performs applicable authentication/discovery. Reachability and supported auth must be tested in the actual connector. A ChatGPT card does not imply Grok UI rendering. [Connectors](https://docs.x.ai/grok/connectors), [public reachability/transport](https://docs.x.ai/grok/connectors/custom-mcp-tunneling) |
| Gemini | Function-calling docs describe Interactions `mcp_server` with Streamable HTTP, headers, allowed tools, and snake_case name `proofttl`. However the Interactions overview still says Gemini 3 remote MCP is unsupported. Selected-model API execution must resolve this documentation inconsistency; no broad availability claim is justified. [Remote MCP example](https://ai.google.dev/gemini-api/docs/function-calling), [overview limitation](https://ai.google.dev/gemini-api/docs/interactions-overview) |
| Copilot Studio | Streamable transport with None/API key/OAuth onboarding options; Power Platform policies apply. Validate the actual reachable preview and chosen header/auth method, then selected tools in the agent trace. [Connect an MCP server](https://learn.microsoft.com/en-us/microsoft-copilot-studio/mcp-add-existing-server-to-agent) |
| Cursor | Remote Streamable HTTP and OAuth/header configuration are documented. Current docs also document MCP Apps support; actual ProofTTL rendering remains untested. Cursor-specific environment interpolation is not portable Agent Plugins interpolation. [MCP documentation](https://cursor.com/docs/mcp) |
| DeepSeek | Official Chat Completions exposes function tools with JSON-schema parameters and model-produced JSON argument strings. The application must execute tools and return paired tool responses. Use the thin MCP/function adapter; no native consumer remote-MCP workflow is established by these API docs. Strict-mode compatibility remains untested and is not enabled. [Chat Completions API](https://api-docs.deepseek.com/api/create-chat-completion/) |

Referenced integration claims were checked from official provider documentation on the assessment date. Product/account/model availability can vary. There are no provider API credentials or connected native-host test sessions evidenced for this milestone.

## Canonical contract and adapter use

Tools discover the server's current closed schemas. Sources are explicit text, authorized base64 UTF-8 `text/plain` bytes, or accepted public HTTPS plain-text URLs. An attachment reference from one provider is not automatically readable by ProofTTL; the host must obtain authorized bytes and use the supported snapshot contract. PDF, arbitrary extraction, private/signed source URLs and archives remain unsupported.

`adapters/mcp-client.js` uses the official SDK transport; `adapters/function-calling.js` converts the six discovered descriptors and preserves the entire MCP result. It does not duplicate claim extraction, evidence retrieval, verdicts, policy, signatures, storage or tenant identity. Unknown tools, malformed function JSON and non-object arguments fail before execution. Server schema/business checks remain authoritative.

For DeepSeek, retain the assistant tool-call message and append the adapter's paired `role: tool` response for each authorized function call. Do not interpret narrative content as policy or suppress `isError`. Application authorization must reflect the user's intended action; an eligible result alone does not request issuance.

Portable `mcp.json` headers and URLs are literal and must contain no secret. [Agent Plugins specification](https://agent-plugins.org/specification) The configured `.invalid` preview URL is intentionally non-operational until replaced after deployment validation.

## Cloud harness and evidence capture

- `node scripts/provider-contract-test.js`: official SDK client through the actual in-process MCP handler and canonical service, with real SQLite D1 fixture. Exercises six schemas/tools, function envelopes, concurrent idempotency, bearer/tenant boundaries, file snapshot, errors and exact result preservation. No model API is called.
- `node scripts/provider-plugin-test.js`: fetches official Agent Plugins schemas and validates manifest/config with strict Ajv 2020; checks four skill packages and endpoint consistency. Does not test skill activation or host installation.
- `node scripts/provider-preview-smoke.js`: requires `PROOFTTL_MCP_URL` and `PROOFTTL_MCP_BEARER_TOKEN` in an authorized cloud runner. Lists tools; optional `--audit` creates a disposable customer-only text audit. Refuses the documented production hostname. Missing configuration exits nonzero as NOT TESTED; it never issues a lease.

A real-host test must capture initialization/discovery, correct and malformed calls, valid/invalid auth, structured results and a permitted snapshot flow. Exercise all six tools against the same isolated endpoint and cross-tenant denial with separate identities. Preserve an issuance key across retries and verify attestation independently using a trusted public key. Store only redacted metadata/evidence links; never record credentials or private source text.

## Remaining gates

An isolated deployed preview is not a production migration. OAuth linking, actual host tool-result behavior, file authorization, model-specific Gemini support, skill activation, signature/key rotation, provider rate limits and native UI must be executed independently. Headless gates passed; the added MCP Apps card awaits cloud browser verification and native-host execution, using `_meta.ui.resourceUri` and the shared bridge rather than client-side verdicts. [UI guidance](https://developers.openai.com/plugins/build/chatgpt-ui)

Gate E remains open until multiple real native MCP hosts exercise the canonical endpoint. Generic adapters and documentation alone do not justify the word universal as a compatibility certification.
