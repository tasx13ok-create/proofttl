# ProofTTL 12-Day Execution Log

This file is the operating record for the 12-day launch sprint. It is not a speculative roadmap; it records verified repository findings, active work, blockers, and the next executable slice.

## DONE

- Mapped the core Worker architecture and the public web application at repository-tree level.
- Confirmed the core already has a functioning Fact Lease primitive with `POST /verify`, `GET /lease/:id`, automatic scheduled re-verification, KV persistence, a D1 due-time index, source fingerprints, lease history, and explicit `SUPPORTED / CONTRADICTED / UNKNOWN` semantics.
- Confirmed Ed25519 issuance signing already exists with canonical JSON attestations and a public key discovery endpoint.
- Confirmed SSRF/public-source validation, request-size limits, location/payer rate limiting, x402 settlement, cost instrumentation, readiness reporting, authentication, audit intake, Stripe audit checkout/webhooks, and extensive regression/security/smoke tests already exist.
- Confirmed the public web repo now has a `/stress-test/` activation surface on the companion sprint branch, plus a revised sample-audit story and an AI-fact-checker acquisition path into the free preflight.
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
- Reached a clean canonical `ProofTTL Code Checks` run on the sprint branch: core security/limits/economics/lease primitives, commercial/account/platform primitives, assistant/entitlement primitives, readiness/auth/payment/research/regression, and the Worker dry-run all passed in run 530.
- Persisted immutable Claim Contract + advisory TTL-policy context on newly issued leases through the existing lease-store adapter without silently changing the effective protocol TTL.
- Added a separate `proofttl-verification-context-v1` Ed25519 attestation/signature that binds Claim Contract, TTL rationale, lease identity, issuance time, and source fingerprint while preserving the existing `proofttl-issuance-v1` signed payload byte-for-byte for compatibility.
- Added tamper tests for the verification-context signature: monitoring-state updates remain valid, while changing the bound source fingerprint or TTL rationale invalidates the context proof.
- Verified the integration in `ProofTTL Code Checks` run 534: every staged suite and the Worker bundle completed successfully on commit `cb9041f29efffb9eb2c3d057fd1fdb740027d4cb`.

## IN PROGRESS

- Exposing the new verification-context signature/version truthfully through discovery and lease responses without implying that policy TTL is already enforced.
- Building the orchestration layer above the existing one-source Fact Lease primitive.

## DISCOVERED

### Strong launch-relevant infrastructure already present

- `src/index.js`: core verify/reverify/monitor engine.
- `src/entry.js`: Hono/x402 public API wrapper, request guards, source validation, signed response enrichment, OpenAPI/discovery surfaces.
- `src/lease-store.js`: durable KV lease wrapper and monitor schedule synchronization.
- `src/monitor-schedule.js`: D1 due-time index for automatic rechecks.
- `src/lease-signing.js`: Ed25519 issuance attestation/signature support.
- `src/truth-state.js`: freshness/volatility/stability derived state and failure conditions.
- `src/security.js`: source URL hardening/SSRF controls.
- `src/costs.js` + tests: verification cost accounting.
- `src/audit-*` + `src/stripe-payments.js`: human Fact Audit sales path.
- `src/readiness.js`: truthful environment/readiness introspection.
- `src/foundry*.js`: experimental research machinery that may later help source discovery/query strategy, but should not displace the verification product.

### Current flagship limitation

The public protocol-level `POST /verify` currently requires both an exact claim and a `source_url`. It verifies a claim against one supplied source and monitors that source over time. That is a strong Fact Lease primitive, but it is not yet the desired top-level experience of `claim/text/URL -> claim decomposition -> multi-source evidence -> contradiction pass -> verdict -> TTL`.

The shortest path is therefore to preserve the existing lease engine and add an orchestration layer above it rather than replace it.

### Reliability findings

- Scheduled live smoke was red for CI configuration reasons, not a demonstrated production verifier outage.
- The canonical code-check pipeline was already red before this sprint. The staged pipeline turned that opaque failure into concrete defects and is now green end-to-end on the sprint branch.
- Reliability work must distinguish product-runtime failure from test-harness drift. A red status that cannot localize the failure is operational noise.

### Evidence-engine design constraint

Multiple URLs must not automatically mean independent corroboration. The evidence ledger supports `underlying_source_id` so mirrors or derivative reports collapse to one evidence origin before corroboration is calculated.

### Signing compatibility constraint

The existing `proofttl-issuance-v1` Ed25519 attestation must remain stable for current clients. Richer verification context is therefore bound by a second versioned signature rather than mutating the signed v1 payload. Monitoring state remains mutable and excluded from both immutable issuance-context attestations.

### TTL rollout constraint

The deterministic TTL engine is currently advisory when attached to an existing protocol lease. The existing caller/default TTL remains the effective lease TTL until a versioned API contract explicitly enables policy-enforced TTL assignment. The persisted context records both the recommendation and the effective legacy TTL so the transition is inspectable rather than silent.

### Product complexity to quarantine during launch

The repos contain substantial assistant/workspace/studio/cinematics/Discord/Reality-Engine infrastructure. Some of it is technically strong, but it is not on the critical verification path. During this sprint it should be treated as existing product surface, not a reason to delay verification work.

## BLOCKED

- True claim-only automated verification still needs a source-discovery/retrieval strategy that is reliable, adversarial, and cost-controlled. The current protocol endpoint intentionally expects a source URL. Do not fake this by generating citations from model memory.
- Production/mainnet protocol settlement has explicit readiness blockers already reported by `src/readiness.js`; human-facing Stripe audit sales are a separate path.

## NEXT

1. Expose the verification-context signature/version truthfully through discovery and lease responses.
2. Expose deterministic long-input claim decomposition as a guarded orchestration/preflight endpoint so the web product can submit text without paying to research filler/opinion claims.
3. Add a source-discovery stage that produces provenance-preserving evidence candidates, then feed them through the evidence-quality ledger instead of counting search results.
4. Add a distinct adversarial contradiction pass and record what was searched to defeat the provisional verdict.
5. Connect the structured verification record to the web `/verify` experience, then public proof pages and monitoring history.

## Architecture decision

Preserve the existing Fact Lease engine. Build the launch product as a thin orchestration/evidence layer above it.

Target flow:

`INPUT -> CLAIM CONTRACTS -> MATERIALITY -> EVIDENCE PLAN -> EVIDENCE FOR/AGAINST -> PROVISIONAL VERDICT -> CONTRADICTION PASS -> FINAL VERDICT -> TTL POLICY -> FACT LEASE -> MONITOR -> HISTORY`
