# ProofTTL 12-Day Execution Log

This file is the operating record for the 12-day launch sprint. It records verified repository findings, shipped work, active blockers, and the next executable slice. Detailed prior states remain recoverable in git history.

## CURRENT FLAGSHIP

`INPUT -> CLAIM CONTRACTS -> TRIAGE -> EVIDENCE PLAN -> EVIDENCE FOR/AGAINST -> PROVISIONAL VERDICT -> CONTRADICTION PASS -> FINAL VERDICT -> TTL POLICY -> FACT LEASE -> MONITOR -> REVERIFY/HISTORY`

Architecture decision: preserve the existing Fact Lease engine and build the launch verifier as a thin orchestration/evidence layer above it.

## SHIPPED / VERIFIED

- Existing Fact Lease primitive remains intact: `POST /verify`, `GET /lease/:id`, scheduled re-verification, KV persistence, D1 due-time indexing, source fingerprints, lease history, and explicit `SUPPORTED / CONTRADICTED / UNKNOWN` semantics.
- Existing Ed25519 issuance signing, monitoring-event signing, SSRF/public-source validation, request-size limits, rate limiting, x402 settlement, cost instrumentation, readiness reporting, authentication, audit intake, Stripe audit checkout/webhooks, and regression/security/smoke coverage were preserved.
- Added deterministic Claim Contracts with normalized claim, scope hints, quantity extraction, volatility, risk, ambiguity flags, evidence support/contradiction contract, and verification priority.
- Added deterministic explainable TTL policy. Automatic TTLs are advisory against legacy leases until a versioned API explicitly enables policy-enforced assignment.
- Added claim decomposition for long input: deterministic segmentation, factual/verifiable filtering, duplicate removal, proposition extraction, and Claim Contract generation.
- Added evidence-quality ledger: source hierarchy, directness, independence, specificity, reputation, freshness, source-conflict penalty, evidence-for/evidence-against, mirror deduplication, measurable confidence, and conservative verdict aggregation.
- Added zero-cost TRIAGE and bounded EVIDENCE PLAN contracts. High-risk claims require a distinct contradiction pass. Retrieval candidates are explicitly not evidence and duplicate origins do not count as independent corroboration.
- Added bounded `POST /claims/decompose`: no external/model calls, no truth verdict, and now returns Claim Contract + TRIAGE + EVIDENCE PLAN with `evidence_retrieval_started: false` and `verdict_issued: false`.
- Persisted immutable Claim Contract + advisory TTL context on issued leases without silently changing protocol TTL behavior.
- Added separate `proofttl-verification-context-v1` Ed25519 attestation binding Claim Contract, TTL rationale, lease identity, issuance time, and source fingerprint while preserving the existing `proofttl-issuance-v1` payload for compatibility.
- Immediate paid `/verify` responses now carry the same immutable context stored on the lease, including the verification-context signature when signing is configured.
- Corrected discovery so signing-dependent capabilities are advertised only when signing is configured.
- Repaired CI reliability: scheduled live smoke was previously failing in `actions/setup-node` because npm caching was configured without a lockfile; removed the invalid cache setting. The canonical regression chain was also split into subsystem stages so failures localize instead of appearing as one opaque red job.
- Repaired assistant/runtime test drift uncovered by the staged suite without weakening production semantics.

## 2026-08-30 EVIDENCE-BUDGET CHECKPOINT

- Added `src/evidence-budget.js`, a pure fail-closed runtime budget state machine for evidence orchestration.
- It enforces action ceilings for candidate queries, source fetches, semantic evaluations, and contradiction queries before work starts.
- Every reserved action must declare a finite non-negative USD reservation. Unknown cost is rejected rather than silently treated as free.
- Settlement records actual spend, releases unused reservation, and rejects actual cost above the amount reserved.
- Hard-dollar enforcement accounts for both already-settled spend and outstanding reservations, preventing oversubscription after prior work has settled.
- Closed/finalized budget states reject additional work.
- Added `scripts/evidence-budget-test.js` and wired it into the canonical `test:local` chain.
- A pre-CI review caught and fixed an accounting edge case where a later reservation could otherwise have ignored already-settled spend. A regression test now covers that case.
- Important boundary: the enforcement primitive is shipped, but `verification-plan.js` still intentionally does **not** invent default dollar ceilings. A real runtime executor must provide a policy ceiling before creating the budget state. This avoids presenting a fabricated all-in cost cap before retrieval-provider economics are selected.

## RELIABILITY STATUS

- Previous sprint checkpoint: staged Code Checks were green end-to-end after static release assertions were aligned with truthful runtime discovery.
- Current evidence-budget changes are under the same canonical Code Checks pipeline. Do not claim this checkpoint green until the head run completes successfully.
- The public web sprint branch remains at its prior evidence-battle/stress-test work; no superficial web changes were made in this checkpoint because core orchestration reliability is the higher-priority blocker.

## CURRENT LIMITATIONS / BLOCKERS

- Protocol-level `POST /verify` still requires an exact claim and `source_url`; it verifies one supplied source and monitors it. The arbitrary `claim/text/URL -> multi-source evidence -> contradiction -> verdict -> TTL` experience is not complete yet.
- Reliable provenance-preserving source discovery with primary-source preference is still missing. Existing Foundry news/research machinery is not being relabeled as a general verification engine.
- A retrieval provider and its request economics are not yet selected, so the planner cannot truthfully emit an all-in hard USD ceiling by itself. The new runtime budget layer will enforce one once supplied by policy/executor configuration.
- Production/mainnet settlement readiness has explicit environment blockers already surfaced by `src/readiness.js`; the Stripe human Fact Audit path is separate.

Neither current blocker requires owner input yet; both are engineering constraints to implement honestly.

## EVIDENCE ENGINE CONSTRAINTS

- Multiple URLs are not automatically independent corroboration. Mirrors/derivative reports must collapse by underlying origin.
- Retrieval results are candidates, not evidence. Accepted evidence requires a position on the exact claim, provenance, observation time, source role, and an independence story.
- High-risk claims require adversarial contradiction search; failure to find support must resolve to `UNKNOWN`, not model-memory invention.
- Existing source fingerprints remain the cheap MONITOR sentinel. Unchanged fingerprints should continue to skip semantic AI work; full re-judgment is conditional on material evidence movement.
- Monitoring state remains mutable and outside immutable issuance-context attestations.

## NEXT EXECUTABLE SLICES

1. Integrate the budget state machine into the first real EVIDENCE executor so every query/fetch/model call must reserve capacity before execution and settle afterward.
2. Select/implement a provenance-preserving source-discovery adapter with primary-source preference and explicit cost metadata.
3. Add an adversarial contradiction executor that records what was searched to defeat the provisional verdict.
4. Feed accepted evidence through the existing evidence-quality ledger and bind final ledger + contradiction result + TTL policy into signed verification context.
5. Connect the proven backend CLAIMS/TRIAGE preflight to the web stress-test/verify surface only after the evidence execution path is real.
6. Then advance permanent proof/history and user-controlled monitoring activation rather than building them ahead of the evidence engine.
