# ProofTTL Production Readiness Audit — 2026-10-09

## Executive status

**NOT PRODUCTION-READY as a mandatory AI response-release control.** The verification gateway is a tested library primitive on `feat/mandatory-verification-gateway`; it is not wired into the deployed assistant response path and does not enforce policy on external model providers.

This is an engineering readiness assessment, not a deployment certification.

## Confirmed in repository

- `src/verification-gateway.js` fails closed when draft/claim inventory is absent or incomplete, a claim is not bound to the draft, risk/source fields are invalid, verification throws, evidence is absent, a lease is expired/inactive, or the adapter does not report a verified signature.
- The gateway enforces the host's `minimumRisk` floor; invalid host policy blocks. Regression assertions cover both cases.
- `src/assistant.js` generates a voice-assistant response through `runAssistantResponse` and returns the text. The response path does not call `evaluateVerificationGate`.
- The ProofTTL API `src/index.js` now supports signing newly issued leases with `src/lease-signing.js` when `PROOFTTL_LEASE_SIGNING_PRIVATE_JWK` is configured, and exposes `/.well-known/proofttl-jwks.json` for public-key discovery.
- `PROOFTTL_REQUIRE_SIGNED_LEASES=true` rejects issuance before source fetching if a valid private key is absent. If that flag is not enabled and no key is configured, legacy unsigned issuance remains possible for compatibility; deployment configuration must be verified before asserting signing is active.
- A new deterministic integration test exercises signed issuance, public-key publication, and the missing-key fail-closed path. Consumer trust configuration and multi-key rotation/revocation remain operational requirements.
- The gateway's `verifyClaim` callback is a trusted adapter boundary. The `signature_verified: true` value is not cryptographic proof by itself; only an adapter that actually validates the signature against a trusted ProofTTL public key may set it.

## Release blockers (must close before claiming enforcement)

### P0 — Do not ship as mandatory enforcement yet

1. **Lease signing and trust chain:** API issuance signing and single-key JWKS publication are now implemented on this branch with deterministic integration coverage. Before production, configure the private key as a secret, enable `PROOFTTL_REQUIRE_SIGNED_LEASES=true`, validate consumer signatures against the trusted key set, and complete tampering, wrong key ID, malformed signature, key rotation, and unsigned legacy-lease tests. Never derive trust solely from a caller-provided boolean.
2. **Response-release integration:** place the gate after draft generation and before any response leaves a ProofTTL-controlled boundary. All fallback/error branches must pass through the same gate or return a blocked/error result. Do not speak, stream, publish, or execute an action before the decision is ALLOW.
3. **Claim-inventory assurance:** require a structured claim inventory bound to the exact draft and produced by a controlled extractor. A model's own `inventoryComplete: true` assertion is not sufficient evidence of completeness. Add adversarial omission, paraphrase, negation, numbers/dates, attribution, and multi-claim sentence tests.
4. **Source/evidence trust:** verify fetched final URLs, redirect handling, source safety, and evidence provenance; ensure the claim checked by the lease is exactly the claim submitted to the gate. Unknown or contradicted claims block.
5. **Cost and abuse controls:** apply authentication, quota, per-request claim caps, timeouts, bounded retries, and spend ceilings to the entire gated operation. Do not add an unauthenticated endpoint that can trigger multiple model-backed verifications without a reviewed billing boundary.
6. **Policy integrity:** risk floor and required-verification mode must be host-owned configuration, not model-controlled input. Any bypass must be separately authorized, scoped, time-limited, and audited.

### P1 — Operational requirements

- Emit structured decision logs with request correlation ID, gate version, claim IDs, lease IDs, verdicts, duration, and block reason. Do not log secrets, private drafts, or unnecessary personal data.
- Add metrics and alerts for block rate, UNKNOWN rate, verifier failures, latency, spend, expired leases, and signature failures.
- Add timeout/cancellation semantics and idempotency where retries could issue duplicate leases or payments.
- Test concurrent requests, provider outage, storage outage, clock skew, malformed JSON, oversized payloads, and rollback behavior.
- Document retention, deletion, data residency, incident response, key rotation, and service-level expectations.
- Run dependency, secret, static-analysis, and deployment-configuration scans; verify production secrets and bindings without printing secret values.

## Required acceptance criteria

A release may be described as enforcing ProofTTL only for a boundary where all of the following are demonstrated:

- The host—not the model—requires the gate.
- No response or protected action is released before ALLOW.
- Every factual claim is inventoried against the exact final draft, with defensible completeness controls.
- Every accepted claim has an active, unexpired lease and a cryptographically verified issuance signature under a trusted published key.
- Any missing/invalid claim, incomplete inventory, verifier failure, timeout, signature failure, or unknown result blocks release.
- Automated tests prove the above, and deployment checks confirm the same configuration is active in production.

## Scope boundary

A third-party AI provider cannot be forced by an external MCP server, prompt, website, or client-side extension to route private model outputs through ProofTTL. Enforcement is possible only at a host/provider-controlled response-release or protected-action boundary that has integrated the gate. A successful MCP tool call, a passing unit test, or a green CI workflow does not establish system-wide enforcement.

## Current conclusion

The gateway, API issuance-signing path, JWKS discovery, and deterministic tests are useful foundations. The response-release integration, independently defensible claim-inventory completeness, production signing configuration, consumer key trust, and operational controls remain open. Do not describe ProofTTL as a universal or production-enforced AI truth layer until the remaining P0 blockers are closed, reviewed, tested end-to-end, and deployed to a controlled boundary.
