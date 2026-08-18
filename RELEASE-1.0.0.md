# ProofTTL v1.0.0

Release date: 2026-08-18

ProofTTL v1.0.0 is the first product release of the source-backed Fact Lease system. The product version is 1.0.0 while the compatible lease/wire protocol remains `ProofTTL/0.3.1`.

## Release contract

- Source-backed verdicts: `SUPPORTED`, `CONTRADICTED`, `UNKNOWN`.
- Lease states: `ACTIVE`, `REVOKED`, `EXPIRED`.
- Persistent Fact Leases with TTL and automatic monitoring.
- Original `issued_status` preserved separately from latest `current_status`.
- Ed25519-signed immutable issuance attestations with public-key discovery.
- Newly persisted monitoring history can be individually Ed25519-signed and SHA-256 hash chained using `proofttl-event-v1`.
- Independent browser verification/export is provided by the frontend.
- L.O.V.E. supports bounded text and voice interaction and uses live Lease storage as authoritative context when a valid `ftl_…` identifier is present.
- MIRA reliability/improvement telemetry remains model-independent and bounded by product safety constraints.
- Better Auth account/security foundations and server-controlled assistant entitlements are present.
- Verification remains protected by x402 v2.

## Settlement boundary

v1.0.0 launches as a **testnet product release**. Verification settlement uses test USDC on Base Sepolia (`eip155:84532`). Mainnet (`eip155:8453`) settlement is intentionally disabled and must not be implied by UI, docs, discovery, or sales material.

The product version therefore describes software/product maturity, not activation of production financial settlement.

## Release gates

A Worker deployment is permitted only after `npm run test:local` passes. That suite includes security, request limits, economics/cost controls, monitor behavior, Lease persistence, issuance signatures, signed monitoring-event chains, CORS, L.O.V.E. text/voice behavior, quota/entitlements, readiness, auth/schema, model routing/evals, x402 payment gating, CDP auth, MIRA, regression tests, and v1 release invariants.

The deployment workflow then requires Cloudflare deployment credentials, runs `wrangler deploy`, and performs the live smoke suite. The live smoke suite authorizes no payment and invokes no AI inference.

## Trust surfaces

The frontend exposes a public Trust Center, service status, Methodology v1, Lease Operations, and an independent Fact Lease verifier. The verifier validates the issuance signature and, when present, signed monitoring-event chain integrity in the browser using the published public key.

## Explicit non-features / locked boundaries

- Base mainnet settlement is disabled.
- Paid L.O.V.E. membership billing is disabled.
- Public manual reverification is disabled; automatic monitoring is the supported path.
- Account-scoped Lease/payment attribution is not fabricated before cryptographic ownership linking exists.
- L.O.V.E. does not invent Lease state when a referenced Lease cannot be loaded.
