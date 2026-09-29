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

Ingestion accepts at most 20 inputs, 100,000 raw bytes per source and 500,000 corpus bytes. Only UTF-8 plain text is supported; PDF, HTML, JSON, archives, compressed responses, private URLs, opaque host file tokens, and transient signed URLs are rejected. URLs require public HTTPS without credentials, query or fragment, no redirects, successful complete `text/plain` responses, and bounded reads. Native host upload-byte authorization remains untested. Metadata labels come from the caller; hashes bind observed bytes, not the credibility of the publisher.

Audits have a 15-minute issuance window and 30-day retained payload horizon. TTL is 60–604800 seconds. Retention scheduling/migration application must be validated in the target runtime. All vNext leases bind immutable snapshots; URL sources may be monitorable but their lease monitoring is `NOT_REGISTERED`. Legacy automatic monitoring does not imply vNext live freshness or revocation.

Draft HS256 tenant bearers are not OAuth account linking. The current portable plugin has a reserved cloud-preview placeholder and no credentials. Replace it with an executed preview endpoint before installation. Real host file flows, UI rendering, and cross-provider compatibility remain separate gates.

## Evidence ledger and acceptance gates

An unchanged integration-base cloud run passed `npm ci`, the full legacy `test:local` suite, and Wrangler dry run: [run 36638369822](https://github.com/tasx13ok-create/proofttl/actions/runs/36638369822). This is baseline evidence only; it does not validate the new canonical code.

New implementation evidence must name the exact tested commit and its cloud run before any PASS is recorded. Required cloud commands include the adversarial corpus runner, canonical audit/MCP tests, `node scripts/provider-contract-test.js`, `node scripts/provider-plugin-test.js`, the full repository suite, and the Worker dry run. The provider contract test exercises the actual handler/service in process and is not a real provider host.

| Gate | Required evidence | Current release claim |
| --- | --- | --- |
| A: verifier | Machine-readable release corpus, zero known false support; no fixture weakening | Pending exact-commit cloud execution; semantic reliability remains unproven |
| B: MCP | SDK initialization/list/calls, schema/auth/bounds/tenant/idempotency/retry/cancel checks | Pending exact-commit cloud execution |
| C: provenance | Immutable source/evidence hashes, server authority, independent signature/tamper checks | Pending exact-commit cloud execution |
| D: customer-only | No outside fetch/model fallback, insufficient evidence and injection cases | Pending exact-commit cloud execution |
| E: cross-host | Same endpoint exercised by multiple actual native hosts | NOT TESTED; adapter checks cannot close this gate |
| F: production | Full CI, dry run, isolated preview, observability, security review and explicit approval | Production not deployed or approved |

The [threat model](MCP-THREAT-MODEL.md) and [provider matrix](PROVIDER-COMPATIBILITY.md) track remaining gaps. MCP Apps UI is deferred until headless correctness is demonstrated.

## Standards decisions

Use the current portable root manifest/config schemas and fixed skill directory rather than inventing a legacy overlay. [OpenAI packaging](https://developers.openai.com/plugins/build/plugins) and [Agent Plugins 1.0.0](https://agent-plugins.org/specification) establish that layout. The server owns security and actions; Skills own workflows. [OpenAI Skills](https://developers.openai.com/plugins/build/skills)

Optional UI must use the MCP Apps bridge and standard resource association while preserving headless results. [OpenAI MCP Apps guidance](https://developers.openai.com/plugins/build/chatgpt-ui) No directory publication, registration, OAuth certification, or real-host PASS is implied by these files.
