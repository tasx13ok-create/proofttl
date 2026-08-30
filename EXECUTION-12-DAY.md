# ProofTTL 12-Day Execution Log

This file is the operating record for the 12-day launch sprint. It is not a speculative roadmap; it records verified repository findings, active work, blockers, and the next executable slice.

## DONE

- Mapped the core Worker architecture and the public web application at repository-tree level.
- Confirmed the core already has a functioning Fact Lease primitive with `POST /verify`, `GET /lease/:id`, automatic scheduled re-verification, KV persistence, a D1 due-time index, source fingerprints, lease history, and explicit `SUPPORTED / CONTRADICTED / UNKNOWN` semantics.
- Confirmed Ed25519 issuance signing already exists with canonical JSON attestations and a public key discovery endpoint.
- Confirmed SSRF/public-source validation, request-size limits, location/payer rate limiting, x402 settlement, cost instrumentation, readiness reporting, authentication, audit intake, Stripe audit checkout/webhooks, and extensive regression/security/smoke tests already exist.
- Confirmed the public web repo has a `/stress-test/` activation surface on the companion sprint branch, plus a revised sample-audit story and an AI-fact-checker acquisition path into the free preflight.
- Added `src/claim-contract.js`: deterministic normalized claim, scope hints, quantity extraction, volatility, risk, ambiguity flags, evidence support/contradiction contract, and verification priority.
- Added `src/ttl-policy.js`: explainable deterministic TTL policy with volatility baselines, confidence/source/contradiction adjustments, caller-request capping, recheck guidance, and explicit invalidation conditions.
- Added `scripts/claim-contract-ttl-test.js` and wired it into the canonical local test chain. The first run exposed a real null-handling bug (`Number(null) === 0`) that incorrectly collapsed automatic TTLs to 60 seconds; fixed it before lease integration.
- Investigated repeated scheduled live-smoke failures. The job had not reached ProofTTL: `actions/setup-node` was failing because npm caching was enabled without a lockfile. Removed the invalid cache configuration.
- Split the previously opaque CI regression chain into subsystem stages so failures localize to launch-critical core, commercial/platform, assistant/entitlement, or readiness/research/regression code.
- Fixed assistant module/runtime drift exposed by the reliability work: exported the existing system prompt, aligned stale safety assertions with current semantics, restored the missing deterministic creator-question predicate, and made the ambiguous-fragment fallback explicit rather than crashing.
- Added `src/claim-decomposition.js`: deterministic long-input segmentation, factual/verifiable filtering, duplicate removal, atomicity hints, proposition extraction, and Claim Contract generation for each candidate claim.
- Added `src/evidence-quality.js`: source hierarchy, directness/independence/specificity/reputation/freshness components, entailment states, source-conflict penalty, evidence-for/evidence-against ledger, mirror deduplication, measurable confidence, and conservative `SUPPORTED / CONTRADICTED / UNKNOWN` aggregation.
- Removed nondeterminism from evidence deduplication so identical evidence sets produce reproducible ledger identities.
- Added `scripts/verification-primitives-test.js` and wired claim decomposition/evidence-ledger tests into both the canonical local suite and CI.
- Calibrated volatility so dynamic commercial facts such as current pricing/features are `HIGH`, while genuinely realtime claims such as live stock prices remain `VERY_HIGH`.
- Persisted immutable Claim Contract + advisory TTL-policy context on newly issued leases through the existing lease-store adapter without silently changing the effective protocol TTL.
- Added a separate `proofttl-verification-context-v1` Ed25519 attestation/signature that binds Claim Contract, TTL rationale, lease identity, issuance time, and source fingerprint while preserving the existing `proofttl-issuance-v1` signed payload byte-for-byte for compatibility.
- Added tamper tests for the verification-context signature: monitoring-state updates remain valid, while changing the bound source fingerprint or TTL rationale invalidates the context proof.
- Made the immediate paid `/verify` response attach the same immutable Claim Contract/TTL context as the persisted lease, and attach its verification-context signature when signing is configured, so callers do not need a second GET to obtain the context that was actually stored.
- Corrected machine discovery so signing-dependent capabilities are advertised only when signing is actually configured. The public signing-key document now exposes separate stable issuance and verification-context signature/attestation versions without exposing private key material.
- Updated a stale release invariant that had required the base static discovery object to claim signed monitoring support even when no signing key existed. Code Checks run 540 passed after the invariant was aligned with truthful runtime discovery.
- Added a bounded deterministic `POST /claims/decompose` API slice. It accepts JSON text/input, rejects non-JSON/oversized/empty input, performs zero external/model calls, and never issues a truth verdict. Code Checks run 537 proved the endpoint and Worker bundle green.
- Added `src/verification-plan.js`: zero-cost deterministic TRIAGE plus typed evidence-planning contracts. Risk, volatility, ambiguity, and caller assurance determine an escalation rung; high-risk claims require a distinct contradiction pass. Retrieval candidates are explicitly not evidence, duplicate origins must collapse, and the failure value is `UNKNOWN`.
- Added `scripts/verification-plan-test.js` and wired it into the canonical local/CI chain. Code Checks run 542 passed every staged suite and Worker dry-run with the new planning contracts.
- Enriched `POST /claims/decompose` so each extracted claim now carries its Claim Contract, zero-cost TRIAGE result, and bounded EVIDENCE PLAN while explicitly reporting `evidence_retrieval_started: false` and `verdict_issued: false`. Code Checks run 543 passed every staged suite and Worker dry-run on commit `84d7f7b3a0cf65fce9fa38df88d9a62de634e075`.

## IN PROGRESS

- Building the first real EVIDENCE orchestration slice above the existing one-source Fact Lease primitive.
- Defining runtime-enforced evidence budgets so query/fetch/model ceilings become actual spend controls rather than documentation. Planning currently refuses to invent a dollar ceiling before runtime pricing enforcement exists.
- Selecting a reliable provenance-preserving source-discovery path with primary-source preference; the existing Foundry news/research fetchers are not being promoted into the verifier merely because they already fetch URLs.

## DISCOVERED

### Strong launch-relevant infrastructure already present

- `src/index.js`: core verify/reverify/monitor engine.
- `src/entry.js`: Hono/x402 public API wrapper, request guards, source validation, signed response enrichment, OpenAPI/discovery surfaces.
- `src/lease-store.js`: durable KV lease wrapper and monitor schedule synchronization.
- `src/monitor-schedule.js`: D1 due-time index for automatic rechecks.
- `src/lease-signing.js`: Ed25519 issuance and verification-context attestation/signature support.
- `src/event-signing.js`: signed monitoring-event chain.
- `src/truth-state.js`: freshness/volatility/stability derived state and failure conditions.
- `src/security.js`: source URL hardening/SSRF controls.
- `src/costs.js` + tests: verification cost accounting with versioned model pricing.
- `src/audit-*` + `src/stripe-payments.js`: human Fact Audit sales path.
- `src/readiness.js`: truthful environment/readiness introspection.
- `src/foundry*.js`: experimental research machinery that may later help source discovery/query strategy, but should not displace the verification product.

### Current flagship limitation

The protocol-level `POST /verify` currently requires both an exact claim and a `source_url`. It verifies a claim against one supplied source and monitors that source over time. That is a strong Fact Lease primitive, but it is not yet the desired top-level experience of `claim/text/URL -> decomposition -> multi-source evidence -> contradiction pass -> verdict -> TTL`.

The shortest path remains preserving the existing lease engine and adding orchestration above it rather than replacing it.

### Claim / triage boundary

`POST /claims/decompose` is now a deterministic zero-dollar preflight through CLAIMS, TRIAGE, and EVIDENCE PLAN. It does not fetch evidence, invoke a model, charge for verification, or issue a verdict. This boundary is deliberate: the system can decide which claims deserve spend before any retrieval or inference begins.

Backend Claim Contracts should become the canonical source for the web Stress Test after deployment of this branch; the existing browser-local extractor remains useful only as an explicitly labeled fallback/preflight aid.

### Reliability findings

- Scheduled live smoke was red for CI configuration reasons, not a demonstrated production verifier outage.
- The canonical code-check pipeline was already red before this sprint. The staged pipeline turned that opaque failure into concrete defects and is now green end-to-end on the sprint branch.
- Reliability work must distinguish product-runtime failure from test-harness drift. A red status that cannot localize the failure is operational noise.
- Run 539 exposed exactly that distinction: all new core/signing tests passed, but a static release assertion contradicted the safer dynamic discovery behavior. The assertion was corrected; the implementation was not weakened to satisfy it.

### Evidence-engine design constraints

- Multiple URLs must not automatically mean independent corroboration. The evidence ledger supports `underlying_source_id` so mirrors or derivative reports collapse to one evidence origin before corroboration is calculated.
- Retrieval results are candidates, not evidence. A candidate must have a position on the exact claim, provenance, observation time, source role, and an independence story before it can enter the evidence ledger.
- `src/foundry-research.js` is bounded and useful research machinery, but its current Hacker News/GDELT sources are not a general primary-source verification engine. It must not be relabeled as one.
- Runtime evidence budgets still need hard dollar enforcement. Until that exists, the plan exposes bounded query/fetch/model counts and marks the dollar ceiling as unresolved rather than presenting false precision.

### WATCH constraint

Existing source fingerprints are already the right cheap sentinel primitive. When a monitored source fingerprint is unchanged, regression tests show ProofTTL skips semantic AI work and records estimated AI cost as zero. Full re-judgment should remain conditional on material evidence movement rather than blind periodic reruns.

### Signing compatibility constraint

The existing `proofttl-issuance-v1` Ed25519 attestation must remain stable for current clients. Richer verification context is bound by a second versioned signature rather than mutating the signed v1 payload. Monitoring state remains mutable and excluded from immutable issuance-context attestations.

### TTL rollout constraint

The deterministic TTL engine is currently advisory when attached to an existing protocol lease. The existing caller/default TTL remains the effective lease TTL until a versioned API contract explicitly enables policy-enforced TTL assignment. The persisted context records both the recommendation and the effective legacy TTL so the transition is inspectable rather than silent.

### Product complexity to quarantine during launch

The repos contain substantial assistant/workspace/studio/cinematics/Discord/Reality-Engine infrastructure. Some of it is technically strong, but it is not on the critical verification path. During this sprint it remains existing product surface, not a reason to delay verification work.

## BLOCKED

- True arbitrary claim-only automated verification still needs a reliable, adversarial, cost-controlled source-discovery mechanism. The current protocol endpoint intentionally expects a source URL. Do not fake this by generating citations from model memory.
- Production/mainnet protocol settlement has explicit readiness blockers already reported by `src/readiness.js`; human-facing Stripe audit sales are a separate path.

Neither item currently requires owner input; both are engineering constraints to work around or implement honestly.

## NEXT

1. Implement runtime evidence-budget accounting/enforcement so escalation rungs have real query/fetch/model/spend ceilings.
2. Add a source-discovery stage that produces provenance-preserving candidates with primary-source preference, then pass accepted sources through the existing evidence-quality ledger rather than counting search results.
3. Add a distinct adversarial contradiction pass and record what was searched to defeat the provisional verdict.
4. Bind final evidence ledger + contradiction result + TTL policy into the signed lease context.
5. Connect the proven backend CLAIMS/TRIAGE preflight to the web `/stress-test/`/future `/verify` experience.
6. Then move to permanent proof/history surfaces and user-controlled monitoring activation; do not build those ahead of the evidence engine.

## Architecture decision

Preserve the existing Fact Lease engine. Build the launch product as a thin orchestration/evidence layer above it.

Target flow:

`INPUT -> CLAIM CONTRACTS -> TRIAGE -> EVIDENCE PLAN -> EVIDENCE FOR/AGAINST -> PROVISIONAL VERDICT -> CONTRADICTION PASS -> FINAL VERDICT -> TTL POLICY -> FACT LEASE -> MONITOR -> HISTORY`
