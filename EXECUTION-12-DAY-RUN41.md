# ProofTTL 12-Day Sprint — Run 41

## Shipped

- Closed a persistence-integrity gap in verification outcome enrichment. A lease that already carried `proofttl-verification-outcome-v1` could previously bypass outcome synchronization entirely, allowing stale top-level `status`, `issued_status`, `current_status`, confidence, reason, or proof-basis mirrors to survive alongside a fail-closed authoritative outcome.
- `attachDerivedVerificationOutcome()` is now idempotent-but-repairing: an existing v1 outcome is preserved rather than recomputed, while the lease's public/current verdict mirrors are synchronized to that outcome.
- `attachImmutableVerificationContext()` now always runs the outcome synchronizer whenever a claim contract exists instead of skipping persisted leases merely because `verification_outcome` is already present.
- Added a regression that simulates a persisted high-assurance lease whose immutable outcome is `UNKNOWN`/`CONTRADICTION_PASS_INCOMPLETE` but whose public aliases have drifted back to a one-source `SUPPORTED` result. Re-enrichment repairs the aliases while leaving the outcome and original source-verdict snapshot unchanged.
- During adjacent review, caught a signature-integrity hazard before finalization: blindly rewriting legacy issuance mirrors would invalidate an existing Ed25519 issuance attestation because `issued_status`, confidence, reason, and proof basis are signed fields.
- Signed legacy leases therefore preserve their historical issuance attestation fields byte-for-byte while `status` and `current_status` move to the authoritative final outcome. Corrected current-only mirrors are exposed through `current_confidence`, `current_reason`, and `current_proof_basis` when the final evidence-standard outcome differs from the historical source-level issuance.
- Added a signed-issuance regression proving the stored issuance attestation remains unchanged and still exactly matches `buildLeaseIssuanceAttestation(lease)` after the current verdict is repaired.

## Verified

- Final substantive checkpoint `c81ae7c9af9f04f174adf7ed1ae70d4e27c26330` passed GitHub Actions `ProofTTL Code Checks` run `34029368168`.
- Every grouped CI stage passed: core security/limits/economics/lease primitives, commercial/account/platform primitives, assistant/entitlement primitives, readiness/auth/routing/payment/research/regression, and Worker bundle validation.
- Final diff from Run 40 head `13e3baf3f852f4027c56260e76d3921315cb12f0` is limited to `src/verification-context.js`, `src/lease-store.js`, and `scripts/verification-context-test.js`; branch is five commits ahead and zero behind that checkpoint.
- The adjacent cryptographic review confirmed issuance attestations sign `issued_status`, confidence, reason, and proof basis, which is why signed legacy repair now separates immutable issuance truth from current authoritative verdict truth rather than silently re-signing history.
- `proofttl-web` sprint and `main` remain identical at `ce43f9eb4000048547e3451aac836c68da0678dd`.
- Fresh Vercel inspection confirms sprint preview `dpl_G9gffm5Dka7uMmLyxskp2PwYYGX9` and production `dpl_6HELAY62mzgDuNRmQ8KNBCFrAXpK` are both `READY` on that exact web commit.
- The 24-hour Vercel runtime audit still shows only the existing Node `url.parse()` DEP0169 deprecation warning on `/api/auth-proxy` and `/api/runtime-proxy` (4 occurrences); no new runtime error class was observed, so no speculative web rewrite was made.

## Remains

- Public `/verify` still evaluates only the caller-provided source and records its Evidence Plan as not executed; real receipt-backed candidate discovery, bounded retrieval, exact-source semantic evaluation, and separately executed adversarial contradiction work still need to be wired into the public path.
- The real SOURCE_FETCH transport still needs to open its network connection using `source_network_binding.addresses` or equivalent constrained egress. Provider-reported `connected_address` is an enforceable orchestration contract, not cryptographic proof that an arbitrary third-party fetch service honored the binding.
- Legacy signed issuance now has an explicit historical/current split when later evidence-standard truth differs. Product/API consumers should prefer `status`/`current_status` and `verification_outcome` for present truth, while `issued_attestation`/`issued_status` remain historical issuance truth.
- Continue auditing adjacent persistence and signing paths for fields that are both mutable product state and members of immutable attestations before wiring executed evidence results into stored leases.
