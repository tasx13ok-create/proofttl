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
- Added `scripts/claim-contract-ttl-test.js` and wired it into the canonical local test chain.
- Executed the new policy primitives against representative dynamic, compliance, and historical claims. The first run exposed a real null-handling bug (`Number(null) === 0`) that incorrectly collapsed automatic TTLs to 60 seconds; fixed it and reran successfully.
- Investigated the latest scheduled GitHub Actions failures. The live smoke job had not reached ProofTTL at all: `actions/setup-node` was failing because `cache: npm` was enabled while the repository has no npm lockfile. Removed the invalid cache configuration so scheduled smoke can reach dependency install and the actual deployed-product checks.

## IN PROGRESS

- Connecting Claim Contract and TTL policy data to the current lease shape while preserving protocol compatibility and existing signing behavior.
- Auditing the existing smoke/regression/readiness suites for failures that currently hide behind the setup-node CI failure.
- Defining the orchestration layer above the existing one-source Fact Lease primitive.

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

### Reliability finding

The scheduled live smoke workflow had been red for repeated runs for CI-configuration reasons rather than a verified production failure. Reliability work must distinguish infrastructure-test failure from product-runtime failure; otherwise a red status creates noise without telling us whether verification itself is unhealthy.

### Product complexity to quarantine during launch

The repos contain substantial assistant/workspace/studio/cinematics/Discord/Reality-Engine infrastructure. Some of it is technically strong, but it is not on the critical verification path. During this sprint it should be treated as existing product surface, not a reason to delay verification work.

## BLOCKED

- True claim-only automated verification needs a source-discovery/retrieval strategy that is both reliable and cost-controlled. The current protocol endpoint intentionally expects a source URL. Do not fake this by generating citations from model memory.
- Production/mainnet protocol settlement has explicit readiness blockers already reported by `src/readiness.js`; human-facing Stripe audit sales are a separate path.

## NEXT

1. Attach normalized claim/scope/TTL rationale fields to new leases without breaking existing clients.
2. Re-run/follow the live smoke pipeline after the workflow fix and fix any real product failures it exposes.
3. Add a verification orchestration endpoint that can accept long text and return atomic candidate claims before expensive evidence work.
4. Add evidence objects with explicit source role, freshness, directness, independence, and entailment state.
5. Add a separate contradiction-pass result rather than a decorative second check.
6. Expose the resulting structured record in `/verify` on the web app, then add public proof pages and monitoring history.

## Architecture decision

Preserve the existing Fact Lease engine. Build the launch product as a thin orchestration/evidence layer above it.

Target flow:

`INPUT -> CLAIM CONTRACTS -> MATERIALITY -> EVIDENCE PLAN -> EVIDENCE FOR/AGAINST -> PROVISIONAL VERDICT -> CONTRADICTION PASS -> FINAL VERDICT -> TTL POLICY -> FACT LEASE -> MONITOR -> HISTORY`
