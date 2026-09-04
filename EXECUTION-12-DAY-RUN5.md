# ProofTTL Execution Addendum — 2026-09-04

## MONITOR RECONCILIATION SAFETY CHECKPOINT

- Re-inspected the monitoring boundary after the D1 work-envelope hardening and found a separate migration reliability gap: active KV leases created before `next_check_at` metadata existed reconcile into D1 with `next_check_at_ms = NULL`, which makes the due query ignore them until expiry.
- Hardened `monitorScheduleRow` so reconciled ACTIVE legacy leases with no persisted next check become immediately due instead of silently falling out of monitoring. Lease state is normalized before persistence so lower-case or whitespace-padded legacy metadata cannot accidentally bypass the D1 ACTIVE filter.
- Added monitor-cost regression coverage proving an active legacy lease with missing `next_check_at` becomes due immediately while an inactive lease stays unscheduled.
- Code commits: `a90cd26e375df33c14e5fe2dc8c40e78ed9613de` (monitor reconciliation safety) and `3ac21ce125e551ef3fa8f8d95044d2d6cfc40f41` (regression coverage).
- `ProofTTL Code Checks` run `33909045467` was triggered for the regression commit and remained in progress at finalization, so this checkpoint does not claim the new head is green yet.
- Adjacent issue discovered and intentionally left for the next focused code pass rather than hand-waving it away: the legacy KV-only `src/index.js` cron loop still enforces `MAX_AUTO_CHECKS_PER_RUN` against successful checks, not attempted reverifications. The D1 path is bounded, but the legacy path can still exceed ten attempts when reverification throws.
- `proofttl-web/10xeffort-12-day-sprint` remains exactly aligned with web `main` at `ce43f9eb4000048547e3451aac836c68da0678dd`; no visual churn was justified by this backend reliability defect.
- Remaining flagship truth boundary is unchanged: public `/verify` still lacks live provenance-preserving independent source discovery and a real adversarial contradiction retrieval execution path. Existing outcome logic should continue to fail closed when required evidence execution is incomplete.
