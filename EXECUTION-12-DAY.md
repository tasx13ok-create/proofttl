# ProofTTL 12-Day Execution Log

## 2026-08-30 EXECUTOR SAFETY CHECKPOINT

- Evidence reservations are now identity-bound by logical idempotency key. Replaying the same logical work does not increment call counts or reserved spend; conflicting reuse is rejected.
- Settlement is identity-bound and idempotent. Failures, timeouts, cancellations, provider-unavailable exits, and unknown-cost failures settle before returning; unknown actual failure cost is conservatively charged at the full reservation rather than leaking capacity.
- Budget denials are structured events carrying denial code, action kind, idempotency key, requested reservation, and remaining capacity.
- Added a budgeted evidence executor boundary. Provider callbacks are only invoked after a granted reservation; denied work never reaches a provider. A settled logical unit cannot invoke the provider twice through the executor.
- Added verification-outcome semantics so budget truncation is not confused with world-level insufficient evidence: evidence verdict/confidence remain inspectable, but overall confidence is withheld when execution is incomplete. If a required contradiction pass is incomplete, the final verdict is forced to `UNKNOWN`.
- No retrieval provider or all-in dollar policy was invented. Source discovery remains the next real blocker.

## CURRENT FLAGSHIP

`INPUT -> CLAIM CONTRACTS -> TRIAGE -> EVIDENCE PLAN -> BUDGETED EVIDENCE EXECUTOR -> EVIDENCE FOR/AGAINST -> PROVISIONAL VERDICT -> CONTRADICTION PASS -> FINAL VERDICT -> TTL POLICY -> FACT LEASE -> MONITOR -> REVERIFY/HISTORY`

## NEXT

1. Select/implement a provenance-preserving source-discovery adapter with explicit request economics and primary-source preference.
2. Route discovery/fetch/semantic/contradiction provider access only through the budgeted executor boundary.
3. Persist execution denials/failures alongside the evidence ledger and signed verification context.
4. Bind the final ledger + contradiction result + TTL policy into the Fact Lease path.
5. Connect the backend path to the web stress-test/verify surface only after real source discovery exists.
