# MCP threat model

Date: 2026-09-29. Applies to the six-tool canonical verification front door, its stored audits/leases, and the thin provider adapter. This is a bounded engineering threat model, not a completed security certification.

## Assets and trust boundaries

Protect tenant bearer credentials, raw customer evidence, immutable audit/result bindings, idempotent lease state, signing private keys, and the integrity of evidence/attestations. The AI host, model output, sources, labels, URLs, and UI are untrusted input. A tool descriptor annotation is a routing hint, never authorization.

A signed credential resolves the tenant at the HTTP boundary. The core reads D1 by tenant plus audit/lease ID. Source bytes become immutable snapshots before verification. Only an eligible stored audit result may be issued. Ed25519 proves integrity of the bound issuance payload relative to a trusted public key; it does not establish universal truth, source credibility, current support, or independent challenge.

| Boundary | Attacker goal | Control and required evidence |
| --- | --- | --- |
| Host/model → tool arguments | Submit `SUPPORTED`, forged provenance, extra fields, arbitrary tenant or oversized JSON | Closed tool/source schemas and bounded bodies; core exact-key validation; tenant comes from verified bearer. Exercise each schema, malformed bodies, batches and unknown tools. |
| HTTP → tenant identity | Forge/expire/replay bearer; access another tenant's audit | Verify HS256, audience `proofttl-mcp`, subject and expiry using server secret; reject missing/invalid credentials before storage/source work. Prove tenant isolation for challenges, comparisons, issuance and reads. |
| Browser → MCP | DNS rebinding/cross-origin invocation | Validate Origin; default same-origin with explicit configured allowlist, never permissive credentialed CORS. Test absent/same/disallowed Origin and malformed headers. |
| Source URL → network | SSRF, redirect to metadata/private address, transient credential leakage | Explicit HTTPS only, all resolved addresses public, no userinfo/query/fragment, no redirects, no long transient path segments. Never forward host bearer/source credentials to a source URL. Test private/mapped IP, DNS, port, redirects and access-policy failures. |
| Source bytes → normalized evidence | MIME spoofing, bombs, invalid UTF-8, malicious instructions, fabricated quote | Narrow plain-text decode/sniffing, byte/corpus limits, no decompression/archive/PDF/HTML/JSON support; hash raw and normalized text. Source text never executes instructions or selects policy. |
| Evidence → verdict | Quoted/refuted/hypothetical/current-vs-historical text falsely supported | Conservative atomics and full-corpus context guard; no canonical model fallback; retain uncertainty. Release fixtures cover reproduced false support; fixture success is not a reliability population estimate. |
| Audit result → lease | Model self-certifies, substitutes another claim, reuses expired audit | Reload immutable tenant audit, verify hashes/spans, select result, reject ineligible/high-consequence result, reevaluate stored corpus and sign bound IDs. Test substitution, tampering, expiry and source/evidence mismatch. |
| Concurrent calls → D1 state | Duplicate issuance or idempotency key rebound to different inputs | Tenant/key unique constraint and atomic insert; request hash detects mismatch. Exercise concurrent identical calls and conflicting retries with real SQLite/D1 behavior. |
| Stored lease → recipient | Payload mutation, forged embedded public key, expiry hidden | Versioned Ed25519 v2 envelope and independent verifier using trusted key; full immutable fields bind to attestation. Effective state derives from expiry. Test tampering across IDs, sources, evidence, TTL and monitoring. |
| Function-call adapter → MCP | Extra backend surface, malformed JSON, lost errors, token leak via redirect | Six-name allowlist, bounded JSON/object input, schema discovery, SDK client, no cross-origin requests or redirects, exact result forwarding. Preserve `isError` and structured content. |
| Optional UI → tools/host | Script injection, verdict calculated in browser, unauthorized issuance | UI remains deferred. Future card must render text safely, use MCP Apps bridge/CSP, and call server tools; no local verifier or automatic lease action. |

## Important residual gaps

- OAuth 2.1 resource metadata, authorization-server discovery/client registration, consent, token scopes, refresh/revocation, and per-user account linking are not implemented by a draft signed bearer. ChatGPT-style linking cannot be called compatible until that full path is executed. Tokens currently confer the tenant's canonical capabilities; scope-limited roles require explicit implementation.
- HS256 is a server trust mechanism. A compromised signing secret permits token minting; use a separate secret from lease-signing material, bounded token lifetime, rotation and no prompt/log storage. Token issuer/operator provisioning needs an audited operational path.
- DNS is validated before a separate fetch. DNS rebinding/check-to-connect races and the target runtime's egress behavior remain a security-review item; lexical/DNS tests alone cannot prove connection pinning.
- Plain-text sniffing and secret rejection are heuristics. They are neither a universal format detector nor complete data-loss prevention. Authorized source bytes and labels are still sensitive and may be retained in D1; establish access, retention cleanup, deletion, encryption and observability practices.
- Conservative exact matching can still miss semantic qualifications, paraphrased contradictions, provenance credibility, stale assertions and jurisdiction/population differences. High-consequence independent challenge and extraction recall remain NOT PROVEN.
- vNext URL snapshots are not registered for monitoring. Do not inherit legacy cron guarantees, mark uploads live, or describe `current_status` as a newly fetched observation.
- Cancellation cannot roll back a completed durable write. After an uncertain timeout/disconnect, retry issuance with identical IDs, TTL and idempotency key. Do not start a new issuance key without reconciling the intended action.
- Signature verification needs a trusted public key, not a key supplied in the same untrusted lease. Key rotation/history and v2 public-key discovery need compatibility review before long-lived client guarantees.
- Rate/tenant quotas, retained corpus costs, automated pruning and runtime migration constraints require deployed validation. In-process tests do not prove production D1, edge/network limits or clean observability.
- Tenant authorization must remain independent of the unrelated Better Auth sessions, x402 bypass example, account routes, and broad legacy discovery. Do not bridge those identities implicitly.

## Verification plan

The release corpus attacks quotes/refutations, prompt injection, contradictory passages, temporal/scope/number qualifiers, fabricated citations and source attachment errors. Canonical service tests attack audit/source/span/attestation integrity and unique-key races. MCP tests attack initialization, each schema, malformed/oversized/unauthorized inputs, cross-tenant reads, retries, timeouts/cancellation and Origin. Provider tests preserve errors and prevent exposed legacy tools or credential redirects.

Record every executed check against its commit and cloud run. No threat-model table row is itself a PASS. Gate E requires actual provider hosts; Gate F requires isolated preview, full CI, observability/security review and explicit production approval.

## Official standards checked

[Streamable HTTP](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports) requires Origin protection and defines response/stream/cancellation behavior. The implemented SDK version's negotiated protocol must be tested rather than assuming an arbitrary future protocol revision.

[OpenAI authentication](https://developers.openai.com/plugins/build/auth) describes the protected-resource/OAuth flow and resource-server token validation. [OpenAI security guidance](https://developers.openai.com/plugins/guides/security-privacy) should be checked again for submission; no submission approval is claimed here.

[Agent Plugins 1.0.0](https://agent-plugins.org/specification) does not provide portable credential interpolation. [MCP Apps](https://modelcontextprotocol.io/extensions/apps/overview) is optional presentation; host-native rendering is not a trust boundary for verdicts.
