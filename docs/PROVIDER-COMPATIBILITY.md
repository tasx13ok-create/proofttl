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
| Generic SDK/function adapter, cloud contract | PASS | PASS | PASS | PASS | PASS: simulated host only | PASS |

Final scoped evidence: commit `6f848ac188df81301e2592957527a2c315eb3107`, [successful run 36643933522](https://github.com/tasx13ok-create/proofttl/actions/runs/36643933522), [artifact 11068305252](https://github.com/tasx13ok-create/proofttl/actions/runs/36643933522/artifacts/11068305252). The [permanent evidence index](../benchmark/release-evidence/6f848ac188df81301e2592957527a2c315eb3107.json) preserves summary records; raw case outputs are in the Actions artifact. Generic contract44, package43, canonical80, headlessMCP31 and Inspector2.8.0 passed. Apps passed with SDK1.7.5/Playwright1.63.0/Chromium153.0.8010.12 using the official simulated AppBridge, not a native provider host. Actual isolated preview tests passed all six tools, file snapshot, independent signing verification, five concurrent initial retries, UNKNOWN refusal and authorization boundaries.

Preview endpoint: [`https://proofttl-universal-preview.tasx13ok.workers.dev/mcp`](https://proofttl-universal-preview.tasx13ok.workers.dev/mcp). It uses synthetic fixtures and rotating draft bearer/signing keys. No stable customer token, OAuth link or portable credentials are supplied. The operator must provide supported host-managed credentials for any separately authorized native-host test. Production compatibility remains NOT TESTED.

Machine-readable status lives in [provider-compatibility.json](../specs/provider-compatibility.json). Record cloud contract results separately from real hosts. The unchanged-base [cloud run 36638369822](https://github.com/tasx13ok-create/proofttl/actions/runs/36638369822) covers legacy tests/dry run only.

## Documented extension surfaces

| Host | Official surface and practical gate |
| --- | --- |
| ChatGPT | Portable plugin with Skills plus remote MCP; optional MCP Apps. Package endpoint is the tested isolated synthetic preview. Private account linking requires the documented OAuth resource/authorization flow, which draft tenant bearer authentication does not supply. [Packaging](https://developers.openai.com/plugins/build/plugins), [authentication](https://developers.openai.com/plugins/build/auth) |
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

Portable `mcp.json` headers and URLs are literal and must contain no secret. [Agent Plugins specification](https://agent-plugins.org/specification) The configured preview URL has executed cloud SDK evidence; host installation, skill activation and native account linking remain NOT TESTED.

## Cloud harness and evidence capture

- `node scripts/provider-contract-test.js`: official SDK client through the actual in-process MCP handler and canonical service, with real SQLite D1 fixture. Exercises six schemas/tools, function envelopes, concurrent idempotency, bearer/tenant boundaries, file snapshot, errors and exact result preservation. No model API is called.
- `node scripts/provider-plugin-test.js`: fetches official Agent Plugins schemas and validates manifest/config with strict Ajv 2020; checks four skill packages and endpoint consistency. Does not test skill activation or host installation.
- `node scripts/provider-preview-smoke.js`: requires `PROOFTTL_MCP_URL` and `PROOFTTL_MCP_BEARER_TOKEN` in an authorized cloud runner. Lists tools; optional `--audit` creates a disposable customer-only text audit. Refuses the documented production hostname. Missing configuration exits nonzero as NOT TESTED; it never issues a lease.

A real-host test must capture initialization/discovery, correct and malformed calls, valid/invalid auth, structured results and a permitted snapshot flow. Exercise all six tools against the same isolated endpoint and cross-tenant denial with separate identities. Preserve an issuance key across retries and verify attestation independently using a trusted public key. Store only redacted metadata/evidence links; never record credentials or private source text.

## Remaining gates

An isolated deployed preview is not a production migration. OAuth linking, actual host tool-result behavior, file authorization, model-specific Gemini support, skill activation, signature/key rotation, provider rate limits and native UI must be executed independently. MCP Apps browser protocol/rendering checks passed with an official simulated host; actual native-host rendering remains NOT TESTED, using `_meta.ui.resourceUri` and the shared bridge rather than client-side verdicts. [UI guidance](https://developers.openai.com/plugins/build/chatgpt-ui)

Gate E remains open until multiple real native MCP hosts exercise the canonical endpoint. Generic adapters and documentation alone do not justify the word universal as a compatibility certification.

## Phase 2: real-user account linking

Base5f8c2028cab8b81acc139dc074b7ec9e41392e2d; stacked branch codex/live-host-auth. Planned https://proofttl-auth-preview.tasx13ok.workers.dev/mcp is NOT TESTED until deployed evidence exists. Phase1 PASS rows above retain synthetic/cloud scope and do not certify OAuth or a real host. Native ChatGPT/Codex round trip remains NOT TESTED; native inline UI is HUMAN VERIFICATION REQUIRED. Follow [real-host steps](REAL-HOST-INTEGRATION.md). Do not test other hosts before the first real OpenAI flow; do not retrieve Dropbox files during design. [Dropbox boundary](DROPBOX-SOURCE-INTEGRATION.md).
