# Real host integration: Phase 2

Assessment: 2026-09-29. Phase 2 base: `5f8c2028cab8b81acc139dc074b7ec9e41392e2d`; stacked branch `codex/live-host-auth`. PR22, production and main are outside this phase. Phase1 cloud SDK/Inspector/Chromium results are preserved in the provider ledger and are not native-host evidence.

Planned OAuth preview: `https://proofttl-auth-preview.tasx13ok.workers.dev/mcp`. Deployment, real-user linking and native calls are NOT TESTED until exact commit/run/host evidence is recorded. Do not substitute the synthetic bearer preview as a real account link.

## Connect the real host

Current official ChatGPT path: Settings → Security and login → Developer mode. Open [Plugins](https://chatgpt.com/plugins), select plus, name it ProofTTL Auth Preview, provide a description and choose public URL under Connection. Enter the Phase2 URL only after deployment passes. Create, review discovered tools, complete account linking, then start a new chat and add the connection from the tools menu. After metadata changes, Refresh the connection and use a new chat. Account/workspace policy may hide developer mode. [Official connection guide](https://developers.openai.com/plugins/deploy/connect-chatgpt)

For the complete package, the official guide separates remote MCP testing from installing the skills/manifest through a local marketplace and Plugins Directory. Cloud-first remote testing does not prove four-skill activation or package installation.

Codex desktop alternative: Settings → MCP servers → Add server → Streamable HTTP; supply name/URL, Save, Restart, then Authenticate. Use /mcp to inspect connected servers. Hosted ChatGPT web does not read local Codex TOML. No user-machine configuration is installed by this work. [Official Codex MCP guide](https://learn.chatgpt.com/docs/extend/mcp?surface=cli)

The account owner must complete login, MFA and consent themselves when requested. Stop only that dependent host action; continue cloud code/tests. Never request a password, bearer, refresh token or authorization code in chat.

## OAuth install contract

Publish protected-resource discovery and a 401 Bearer resource_metadata challenge; authorization discovery must advertise S256. Bind the exact resource through authorization/token requests and token audience. Resolve tenant and scopes from validated server credentials.

Copy the exact redirect/client identifiers from the host management page. Eligible RFC9207 issuer-identification deployments use `https://chatgpt.com/connector_platform_oauth_redirect` and CIMD `https://chatgpt.com/oauth/client.json`; otherwise they use callback-specific paths. Eligibility requires truthful metadata and exact `iss` on success and error responses. No wildcard redirect registration. CIMD, DCR or predefined client support must reflect implemented behavior; refresh/revocation and identity-provider trust belong in AUTH-ARCHITECTURE.md. No seventh profile tool is needed merely to connect; profile metadata is optional. [Official authentication contract](https://developers.openai.com/plugins/build/auth)

The portable root manifest, MCP config and four Skills use [Agent Plugins schemas](https://agent-plugins.org/specification); secret-free packaging does not implement OAuth. [Official packaging](https://developers.openai.com/plugins/build/plugins)

## Real-user test sequence

Record exact deployed commit, host surface/version, date, account-link flow and redacted invocation evidence.

1. Ask: Using only this customer source, audit the claim Example Company retains backups for 30 days. Source: The Example Company policy says backups are retained for 30 days. Use customer_only; do not browse.
2. Preserve the actual verdict. Attribution/paraphrase is outside the current exact matcher; UNKNOWN is acceptable and must never be rewritten into SUPPORTED.
3. Submit the exact atomic control source and claim: Example Company retains backups for 30 days. Confirm server-returned eligibility, audit_id, claim_result_id, spans and hashes.
4. Invoke challenge_claim and compare_evidence using those returned IDs.
5. Explicitly request create_fact_lease with the same IDs, TTL300 and one stable idempotency key. Retry the same request, then get_fact_lease using its returned lease_id. Verify the same lease, expiry/state and server-authoritative result.
6. Invoke audit_output on customer-controlled text and inspect each extracted result; do not infer extraction recall.
7. Audit the 30-day claim against Backups are retained for 14 days, then There is no documented backup retention period. Both must avoid SUPPORTED, report uncertainty and refuse issuance. No public/model fallback.
8. Exercise invalid/expired/audience/scope/revoked credentials and cross-tenant audit/lease reads in authorized cloud security tests, never by exposing another customer's evidence.

No host PASS until a real user identity links and performs audit → challenge → issuance → read through the supported AI-host connection. A proxy, direct API SDK, successful discovery or model narrative alone does not satisfy that sequence.

## Actual inline component

Status: HUMAN VERIFICATION REQUIRED until the real host renders it. In the connected conversation inspect verdict, evidence, source label, observation timestamp, server eligibility, lease ID, expiry and state. Press Challenge and Compare, then explicitly request Create lease. Capture redacted tool invocation evidence confirming each button reaches the server. Confirm UNKNOWN disables issuance and source markup stays literal text. No card-local verdict or independent signature-verification claim.

The existing cloud App/AppBridge browser harness remains a separate gate; it does not prove ChatGPT/Codex native rendering. A human screenshot alone does not prove tool execution; pair it with redacted invocation records.

## Remaining status

ChatGPT/Codex discovery, real authentication, six-tool execution and customer source round trip: NOT TESTED. UI: HUMAN VERIFICATION REQUIRED. Other providers and DeepSeek actual API remain NOT TESTED and are scheduled only after the first OpenAI host proof. Dropbox implementation waits for that proof.
