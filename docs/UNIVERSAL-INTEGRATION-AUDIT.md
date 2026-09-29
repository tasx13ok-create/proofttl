# Universal integration audit

Assessment date: 2026-09-29. Scope: the backend repository, software-first verification engine, canonical MCP front door, portable plugin, and thin provider adapters. Implementation is on `codex/universal-proof-engine`; production and the website are outside this milestone.

Read the complete [handoff](ASTRA-CODEX-UNIVERSAL-INTEGRATION-HANDOFF.md). The source files and executed evidence override aspirations in older design documents.

## Findings at the integration baseline

The legacy Worker has real verification, source limits/SSRF checks, KV leases, D1 monitoring indexes, and Ed25519 signatures. It also contains assistant, account, studio, automation, Discord, Foundry, and commercial audit routes. `POST /mcp/test-lease` is an example lease convenience route, not an MCP transport. Existing discovery and OpenAPI describe legacy capabilities and cannot certify a new endpoint.

| Module | Classification | Boundary and coupling |
| --- | --- | --- |
| `src/index.js` | CORE VERIFICATION; DANGEROUS COUPLING | Legacy verification, issuance, monitoring, and Workers AI live together. Canonical audits import only guarded deterministic checking/context risks; they do not call the legacy paid HTTP route or semantic fallback. |
| `src/security.js`, `src/limits.js` | REQUIRED SUPPORT | Public-address validation and bounded source/request reads. Canonical ingestion applies additional narrow MIME, HTTPS, query, and redirect constraints. |
| `src/entry.js` | REQUIRED SUPPORT; DANGEROUS COUPLING | Hono/x402, legacy discovery, AI/KV wrappers, and public example-lease bypass. These are not the canonical audit service. |
| `src/lease-store.js`, `src/monitor-schedule.js` | REQUIRED SUPPORT, legacy leases | KV payloads with D1 scheduling/reconciliation. Legacy signing is additive/fail-open; canonical issuance uses a separate fail-closed attestation path. |
| `src/lease-signing.js`, `src/event-signing.js` | REQUIRED SUPPORT, legacy attestations | Existing v1 issuance/events must retain their semantics; vNext has a distinct v2 envelope and independent verifier. |
| `src/discovery.js` | REQUIRED SUPPORT; DANGEROUS COUPLING | Broad public metadata includes unrelated product capabilities. Advertising a route is not proof of deployed MCP compatibility. |
| `src/worker.js` | DANGEROUS COUPLING | Large shared router and scheduler. Keep MCP routing explicit and ahead of generic legacy fallbacks. |
| assistant, account, studio, cinematics, Discord, Foundry modules | UNRELATED PRODUCT for this milestone | Preserve their existing routes/tests; never advertise them as verification MCP tools. |

## Added canonical seams

- `src/sources/ingest.js`: customer text/file snapshots and explicit public HTTPS plain-text URLs; raw and normalized text hashes; untrusted-source handling.
- `src/audits/service.js`: durable immutable audits, deterministic claim extraction/checking, tenant-scoped reads, authoritative audit-to-lease issuance, atomic idempotency, v2 signing/verification.
- `src/mcp/handler.js`: official SDK stateless Streamable HTTP front door over `executeTool`; six advertised tools, structured results, signed tenant bearer identity, bounds, and safe errors.
- `adapters/`: official SDK client and function-call envelope conversion. No provider-specific verifier, lease eligibility, source retrieval, or signing logic.
- `plugin/proofttl/`: portable package and exactly four focused workflow Skills.

These seams avoid a giant rewrite and preserve existing legacy verification/payment/monitoring behavior. The canonical service uses D1 records rather than routing requests through arbitrary public Worker endpoints.

## Defensible current claims and deliberate limitations

The six tools are `audit_claim`, `audit_output`, `challenge_claim`, `compare_evidence`, `create_fact_lease`, and `get_fact_lease`. Inputs never accept a caller-authored verdict or tenant identity. Lease issuance reloads, integrity-checks, and reevaluates the stored result. A concurrent retry uses a single tenant/idempotency unique D1 insert.

The canonical verifier currently returns `SUPPORTED` or `UNKNOWN`. Support requires an atomic, context-safe exact claim match in every supplied source. Unproved disagreement or qualification remains uncertain; this is not a complete semantic contradiction classifier. Output decomposition is deterministic sentence/clause extraction with recall explicitly NOT PROVEN. High/critical consequence results are lease-ineligible because independent challenge is NOT PROVEN.

All three source policies are explicit. `customer_only` makes no AI/model/world-knowledge or public discovery call; empty sources produce uncertainty. `customer_plus_public` currently provides no automatic discovery or broader challenge. `public_only` accepts explicit URL sources only. Challenge and comparison inspect the immutable bound corpus, not a new independent research pass.

Ingestion accepts at most 20 inputs, 100,000 raw bytes per source and 500,000 corpus bytes. Only UTF-8 plain text is supported; PDF, HTML, JSON, archives, compressed responses, private URLs, opaque host file tokens, and recognized transient signed URLs are rejected. Arbitrary opaque credential URL paths are NOT PROVEN to be detectable. URLs require public HTTPS without credentials, query or fragment, no redirects, successful complete `text/plain` responses, and bounded reads. Native host upload-byte authorization remains untested. Metadata labels come from the caller; hashes bind observed bytes, not the credibility of the publisher.

Audits have a 15-minute issuance window and 30-day retained payload horizon. TTL is 60–604800 seconds. Retention scheduling/migration application must be validated in the target runtime. All vNext leases bind immutable snapshots; URL sources may be monitorable but their lease monitoring is `NOT_REGISTERED`. Legacy automatic monitoring does not imply vNext live freshness or revocation.

Draft HS256 tenant bearers are not OAuth account linking. The portable plugin points to the tested isolated synthetic preview https://proofttl-universal-preview.tasx13ok.workers.dev/mcp and contains no credentials. Preview tenant bearer and signing keys rotate with cloud deployment; there is no stable user token or OAuth linking. Real host file flows, UI rendering, and cross-provider compatibility remain separate gates.

## Evidence ledger and acceptance gates

Final executed implementation: commit `6f848ac188df81301e2592957527a2c315eb3107`, [successful cloud run 36643933522](https://github.com/tasx13ok-create/proofttl/actions/runs/36643933522), [machine-readable evidence artifact 11068305252](https://github.com/tasx13ok-create/proofttl/actions/runs/36643933522/artifacts/11068305252). The [permanent evidence index](../benchmark/release-evidence/6f848ac188df81301e2592957527a2c315eb3107.json) summarizes executed machine JSON; full per-case outputs remain in the linked Actions artifact. All checks below passed at that commit; a later documentation/configuration commit must receive its own CI rather than inheriting this exact-commit claim.

| Check | Executed result and scope |
| --- | --- |
| Release corpus | 145 cases / 289 checks; baseline false supports 209 overall / 170 direct; guarded false supports 0 overall / 0 direct; supported 39/39; UNKNOWN rate 0.8650519031141869. This is fixture evidence, not a population reliability estimate. |
| Canonical service | 80 checks: immutable audits, source trust boundary, temporal as_of preservation, issuer authority, integrity, signatures and idempotency. |
| Headless MCP | 31 checks against actual handler/service; transport/auth/schema/tenant boundaries. |
| Provider adapter | 44 cloud contract checks; generic SDK and function-call envelopes, no actual provider model API. |
| Portable package | 43 strict official-schema/package checks; four skills, no host activation/installation claim. |
| Inspector | Official MCP Inspector 2.8.0: resource list/read, all six calls, retry and independent signature verification. |
| Regression and bundle | Full repository suite and Cloudflare Worker dry run passed. |
| MCP Apps | SDK 1.7.5, Playwright 1.63.0, Chromium 153.0.8010.12; official App/AppBridge simulated host handshake, three canonical tool buttons, signed-lease display and safe text rendering. The card labels server-reported signature verification; no independent browser verifier. |
| Isolated deployed preview | All six deployed tools, file snapshot, independent signed-lease verification, five concurrent initial retries returning one lease, UNKNOWN lease refusal, cross-tenant denial and unauthenticated denial passed. |

The preview is [`https://proofttl-universal-preview.tasx13ok.workers.dev/mcp`](https://proofttl-universal-preview.tasx13ok.workers.dev/mcp), backed by the isolated `proofttl-universal-preview` Worker and preview-only D1. It serves synthetic fixtures with rotating draft bearer/signing keys. No portable secret, stable user token, OAuth linking, production migration or production-readiness approval is supplied.

Earlier failures remain in their run histories: Apps initialization failed before the function-replacer build fix; deployed signing failed before the Node 24/workerd JWK compatibility correction. The final run closes these reproduced failures without changing verifier assertions.

| Gate | Current claim |
| --- | --- |
| A: verifier | PASS for this unchanged release corpus; semantic generalization and extraction recall remain NOT PROVEN. |
| B: MCP | PASS for headless and isolated synthetic-preview tests at `6f848ac188df81301e2592957527a2c315eb3107`. |
| C: provenance | PASS for tested immutable bindings, issuer authority and independent signature/tamper checks; trusted key lifecycle remains operational work. |
| D: customer-only | PASS for tested no-outside-fetch/model and insufficient/injection cases. |
| E: cross-host | NOT TESTED: no actual ChatGPT, Codex, Claude, Grok, Gemini, Copilot Studio, Cursor or DeepSeek API execution. |
| F: production | Not deployed or approved. Preview/CI success does not close operational, OAuth, monitoring or production-security gates. |

The [threat model](MCP-THREAT-MODEL.md) and [provider matrix](PROVIDER-COMPATIBILITY.md) retain residuals. Every canonical tool remains usable headlessly.

## Standards decisions

Use the current portable root manifest/config schemas and fixed skill directory rather than inventing a legacy overlay. [OpenAI packaging](https://developers.openai.com/plugins/build/plugins) and [Agent Plugins 1.0.0](https://agent-plugins.org/specification) establish that layout. The server owns security and actions; Skills own workflows. [OpenAI Skills](https://developers.openai.com/plugins/build/skills)

Optional UI must use the MCP Apps bridge and standard resource association while preserving headless results. [OpenAI MCP Apps guidance](https://developers.openai.com/plugins/build/chatgpt-ui) No directory publication, registration, OAuth certification, or real-host PASS is implied by these files.
