# ProofTTL 12-Day Execution Log

## 2026-08-31 FLAGSHIP OFFER / PAYMENT CONTRACT CHECKPOINT

- Inspected current sprint heads after the website hard reset; treated current repo/deployment state as authoritative and did not touch retired `/studio` surfaces.
- Found a payment-critical split-brain bug in core: the web sprint had already moved to the single $1,500 Fact Audit, while backend intake still advertised `$129` Claim Stress Test / `$500` Full Verification Audit, admin scoping enforced those legacy prices, and Stripe checkout only accepted `$129`, `$371`, or `$500`.
- Replaced new-intake commercial behavior with one canonical Fact Audit contract: 10-25 claims, $1,500, seven-day monitoring, explicit human approval. The persisted `full_audit` identifier remains only for backwards-compatible schema/query behavior; new `stress_test` intake is rejected and `fact_audit` is accepted.
- Admin scoping now fails closed unless the amount is exactly $1,500 and the declared claim bucket is within 10-25. The legacy upgrade endpoint returns `410 offer_upgrade_retired` instead of creating a $371 balance.
- Stripe checkout now fails closed unless scoped price, credit, and amount due resolve exactly to $1,500. Checkout metadata and line-item naming identify `ProofTTL Fact Audit`; paid webhooks reject non-$1,500 records and amount mismatches.
- Open Stripe checkout reuse now validates intake identity and available amount metadata before reusing a session rather than trusting any open stored session URL.
- Updated audit intake, sales-lifecycle, and Stripe regression tests for the canonical offer. New head after test updates: `9fa233e62a716d7192fe8a18ec2f6775c5aded87`. CI status had not populated at the time of this checkpoint, so this slice is not yet marked green.

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

1. Get the canonical $1,500 intake/sales/Stripe slice green in CI; fix any regression before moving on.
2. Select/implement a provenance-preserving source-discovery adapter with explicit request economics and primary-source preference.
3. Route discovery/fetch/semantic/contradiction provider access only through the budgeted executor boundary.
4. Persist execution denials/failures alongside the evidence ledger and signed verification context.
5. Bind the final ledger + contradiction result + TTL policy into the Fact Lease path.
