# ProofTTL 12-Day Execution — Run 34

Date: 2026-09-06
Branch: `10xeffort-12-day-sprint`

## Shipped

- Closed an evidence-ledger duplicate amplification gap in `src/evidence-quality.js`.
- Previously, `dedupeEvidence()` preferred `underlying_source_id` over URL identity. The same fetched source URL could therefore enter the verdict-bearing ledger more than once when providers assigned different underlying IDs, allowing duplicate evidence to increase `sideStrength()` as if it were corroboration.
- Replaced the single-key identity rule with alias-aware grouping: normalized URL identity and `underlying_source_id` are both treated as deduplication aliases.
- Alias groups merge transitively, so a bridge record that links one URL to a second underlying ID cannot leave a mirror of that second ID counted separately.
- The highest-quality item is retained as the representative for each merged source-origin group, preserving the prior quality preference while preventing duplicate strength inflation.
- Added focused regressions proving that the same URL with conflicting underlying IDs counts once and that URL/underlying-ID alias chains collapse transitively.

## Verification

- Final code-bearing checkpoint: `87b234bf063094bec79544fb155308366dd7ccb3`.
- GitHub Actions `ProofTTL Code Checks` run `34010547521`: completed successfully.
- Core security, limits, economics, lease, verification, evidence budget/executor/runtime/orchestrator, execution-summary, plan-binding, verification-context, decomposition, discovery-signing, and event-signing checks passed.
- Commercial, account, and platform primitive checks passed.
- Assistant and entitlement primitive checks passed.
- Readiness, auth, routing, payment, research, regression, and release checks passed.
- Worker bundle validation passed.

## Deployment / drift check

- `proofttl-web` sprint remains at `ce43f9eb4000048547e3451aac836c68da0678dd`; no unrelated web change was introduced in this pass.
- Fresh Vercel inspection shows sprint preview deployment `dpl_G9gffm5Dka7uMmLyxskp2PwYYGX9` is `READY` on `ce43f9eb4000048547e3451aac836c68da0678dd`.
- Fresh Vercel inspection shows production deployment `dpl_6HELAY62mzgDuNRmQ8KNBCFrAXpK` is `READY` on the same commit.
- Fresh 24-hour runtime-error aggregation still shows only the existing Node `DEP0169` `url.parse()` deprecation-warning group on `/api/auth-proxy` and `/api/runtime-proxy`; no new application request-failure cluster surfaced.
- Direct inspection of both proxy handlers found no application-level `url.parse()` call, so no speculative web rewrite was made during this correctness pass.

## Finalization review

The code-bearing diff from the previous sprint head `c3e132737fb162929dfb3ad00c22e82380522df2` is intentionally narrow: `src/evidence-quality.js` and `scripts/verification-primitives-test.js`. The change is reversible and conservative: records are collapsed when either traceable URL identity or declared underlying-source identity proves they are the same origin, while the strongest representative remains available to the ledger. The final code checkpoint passed the full CI workflow before this log was added.

## Remaining highest-value boundary

The immediate transport-security boundary remains binding the real source-fetch implementation to the freshly validated address set, or equivalent constrained egress, so DNS validation and the actual connection cannot diverge.

The major product boundary remains production provider integration into public `/verify`: independent discovery, bounded retrieval, exact-source semantic evaluation, configured provider pricing, and a genuinely separate adversarial contradiction path still need to execute through the hardened evidence runtime before receipt-backed automated verification is exposed as a production capability.
