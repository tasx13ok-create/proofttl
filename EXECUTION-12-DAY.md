# ProofTTL 12-Day Execution Log

## 2026-08-31 MONITOR / REVERIFY RELIABILITY CHECKPOINT

- Inspected both sprint branch heads. Core CI was green at `8462442f56977c9c024773cbadd8739a266afeac`; web CI was green at `d1d26277644ab5eaf33d560eb2d183c87f4146d8` before this core reliability change.
- Found a real repair-path starvation bug in the D1 monitor scheduler reconciliation. The sharded reconciliation performed a single 1,000-key KV list, and `reconcileMonitorScheduleBatch` silently truncated that page to the first 100 rows. If normal D1 schedule upserts had failed, leases beyond those rows could remain absent from the due-time index and therefore miss automatic reverification.
- Fixed reconciliation to paginate every KV page in the selected shard and fixed the D1 reconciliation helper to process every valid row in bounded batches of 100 statements rather than truncating the input.
- Added regression coverage with 1,001 selected-shard leases. The test requires two KV pages, verifies cursor propagation, verifies all 1,001 rows are reconciled, and verifies every D1 batch remains capped at 100 statements.
- This preserves KV as source of truth while making the D1 repair path match the reliability claim in `MONITORING.md`: scheduler-index failures can now be repaired beyond the first page / first 100 rows.

## 2026-08-30 EXECUTOR SAFETY CHECKPOINT

- Evidence reservations are now identity-bound by logical idempotency key. Replaying the same logical work does not increment call counts or reserved spend; conflicting reuse is rejected.
- Settlement is identity-bound and idempotent. Failures, timeouts, cancellations, provider-unavailable exits, and unknown-cost failures settle before returning; unknown actual failure cost is conservatively charged at the full reservation rather than leaking capacity.
- Budget denials are structured events carrying denial code, action kind, idempotency key, requested reservation, and remaining capacity.
- Added a budgeted evidence executor boundary. Provider callbacks are only invoked after a granted reservation; denied work never reaches a provider. A settled logical unit cannot invoke the provider twice through the executor.
- Added verification-outcome semantics so budget truncation is not confused with world-level insufficient evidence: evidence verdict/confidence remain inspectable, but overall confidence is withheld when execution is incomplete. If a required contradiction pass is incomplete, the final verdict is forced to `UNKNOWN`.
- Post-write CI inspection found that the staged core workflow bypassed `test:local` and omitted `test:evidence-budget`. The workflow now invokes the evidence executor/budget regression suite explicitly, so this slice cannot receive a green staged check without running its own coverage.
- No retrieval provider or all-in dollar policy was invented. Source discovery remains the next real blocker.

## CURRENT FLAGSHIP

`INPUT -> CLAIM CONTRACTS -> TRIAGE -> EVIDENCE PLAN -> BUDGETED EVIDENCE EXECUTOR -> EVIDENCE FOR/AGAINST -> PROVISIONAL VERDICT -> CONTRADICTION PASS -> FINAL VERDICT -> TTL POLICY -> FACT LEASE -> MONITOR -> REVERIFY/HISTORY`

## NEXT

1. Select/implement a provenance-preserving source-discovery adapter with explicit request economics and primary-source preference.
2. Route discovery/fetch/semantic/contradiction provider access only through the budgeted executor boundary.
3. Persist execution denials/failures alongside the evidence ledger and signed verification context.
4. Bind the final ledger + contradiction result + TTL policy into the Fact Lease path.
5. Connect the backend path to the web stress-test/verify surface only after real source discovery exists.
