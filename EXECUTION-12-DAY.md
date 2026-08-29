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
- Split the previously opaque CI regression chain into subsystem stages. This proved core security/limits/economics/lease tests and commercial/account/platform tests are green and isolated an unrelated assistant contract drift instead of treating every red run as a verifier failure.
- Fixed the assistant module/test contract drift that prevented the canonical suite from loading (`assistantSystemPrompt` existed but was not exported), then aligned stale wording assertions with the current safety semantics rather than weakening the prompt.
- Added `src/claim-decomposition.js`: deterministic long-input segmentation, factual/verifiable filtering, duplicate removal, atomicity hints, proposition extraction, and Claim Contract generation for each candidate claim.
- Added `src/evidence-quality.js`: source hierarchy, directness/independence/specificity/reputation/freshness components, entailment states, source-conflict penalty, evidence-for/evidence-against ledger, mirror deduplication, measurable confidence, and conservative `SUPPORTED / CONTRADICTED / UNKNOWN` aggregation.
- Removed nondeterminism from evidence deduplication so identical evidence sets produce reproducible ledger identities.
- Added `scripts/verification-primitives-test.js` and wired claim decomposition/evidence-ledger tests into both the canonical local suite and CI.

## IN PROGRESS

- Driving the full CI suite to green so launch work is built on a reliable baseline rather than a historically red pipeline.
- Connecting Claim Contract and TTL policy data to the persisted/signed lease lifecycle without silently changing the existing protocol contract.
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
- The canonical code-check pipeline was also already red before this sprint. Subsystem staging showed the launch-critical security, limits, economics, lease, audit, payment, account, platform, and CORS primitives pass; the first exposed failure was stale assistant module/test coupling.
- Reliability work must distinguish product-runtime failure from test-harness drift. A red status that cannot localize the failure is operational noise.

### Evidence-engine design constraint

Multiple URLs must not automatically mean independent corroboration. The evidence ledger now supports `underlying_source_id` so mirrors or derivative reports can collapse to one evidence origin before corroboration is calculated.

### Product complexity to quarantine during launch

The repos contain substantial assistant/workspace/studio/cinematics/Discord/Reality-Engine infrastructure. Some of it is technically strong, but it is not on the critical verification path. During this sprint it should be treated as existing product surface, not a reason to delay verification work.

## BLOCKED

- True claim-only automated verification still needs a source-discovery/retrieval strategy that is reliable, adversarial, and cost-controlled. The current protocol endpoint intentionally expects a source URL. Do not fake this by generating citations from model memory.
- Production/mainnet protocol settlement has explicit readiness blockers already reported by `src/readiness.js`; human-facing Stripe audit sales are a separate path.

## NEXT

1. Finish the canonical CI pass and repair the next real failure it exposes.
2. Persist Claim Contract + TTL rationale on newly issued leases while preserving existing clients and cryptographic verification behavior.
3. Expose deterministic long-input claim decomposition as a guarded orchestration/preflight endpoint so the web product can submit text without paying to research filler/opinion claims.
4. Add a source-discovery stage that produces provenance-preserving evidence candidates, then feed them through the evidence-quality ledger instead of counting search results.
5. Add a distinct adversarial contradiction pass and record what was searched to defeat the provisional verdict.
6. Connect the structured verification record to the web `/verify` experience, then public proof pages and monitoring history.

## Architecture decision

Preserve the existing Fact Lease engine. Build the launch product as a thin orchestration/evidence layer above it.

Target flow:

`INPUT -> CLAIM CONTRACTS -> MATERIALITY -> EVIDENCE PLAN -> EVIDENCE FOR/AGAINST -> PROVISIONAL VERDICT -> CONTRADICTION PASS -> FINAL VERDICT -> TTL POLICY -> FACT LEASE -> MONITOR -> HISTORY`
