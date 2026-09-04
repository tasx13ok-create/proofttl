# ProofTTL Execution Addendum — 2026-09-04

## MONITOR WORK-ENVELOPE HARDENING CHECKPOINT

- Re-inspected the production scheduled-monitor path and found that the advertised `MAX_AUTO_CHECKS_PER_RUN = 10` ceiling was enforced against successful reverifications only. A batch of due leases whose reverification throws could therefore continue iterating well beyond ten attempts, creating an avoidable source-fetch/error burst and weakening the intended per-run cost boundary.
- Hardened the D1 due scheduler itself so an oversized caller request is capped at ten due leases. This makes the production D1-backed monitor work envelope independent of whether individual reverifications succeed or fail.
- Expanded `scripts/monitor-cost-test.js` with a regression that asks the D1 scheduler for 1,000 due leases and proves the bound query and returned batch are both capped at ten.
- Code commits: `1bc47b85d22c1b9e2021c8bccfdbb398b35e19be` (scheduler hard cap) and `1cf0e9b6888dcb24cfabbc182375cdc928e14bc9` (regression coverage).
- `ProofTTL Code Checks` run `33903659073` was triggered for the regression commit and was still in progress at the end of this pass, so this checkpoint does not claim the new head is green yet.
- `proofttl-web/10xeffort-12-day-sprint` remains at `ce43f9eb4000048547e3451aac836c68da0678dd`; no web changes were justified by this backend reliability defect.
- Remaining truth boundary is unchanged: public `/verify` still lacks a live provenance-preserving independent discovery provider and a real adversarial contradiction retrieval execution path. The existing final-outcome layer continues to fail closed to `UNKNOWN` when that required execution is incomplete.
