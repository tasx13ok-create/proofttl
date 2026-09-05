# ProofTTL 12-Day Execution — Run 29

Date: 2026-09-05
Branch: `10xeffort-12-day-sprint`

## Shipped

- Hardened evidence temporal provenance in `src/evidence-quality.js`.
- Evidence with a syntactically valid `published_at` / `updated_at` later than its `observed_at` is now rejected from the verdict-bearing ledger.
- Added explicit reason code `REJECTED_PUBLICATION_AFTER_OBSERVATION` so the failure remains inspectable rather than collapsing into generic quality rejection.
- Preserved the existing freshness calculation for explainability while preventing impossible chronology from gaining acceptance simply because negative age was clamped to zero.
- Added a verification-primitives regression that constructs otherwise maximum-quality, traceable, verbatim evidence with publication one day after observation and proves it remains rejected even though its raw freshness score is 1.

## Verified

- Code checkpoint: `93a5747acbd14bfae978ab7f599a8ff2ab587f9a`.
- GitHub Actions `ProofTTL Code Checks` run `33997635256`: `local-checks` completed successfully.
- All grouped correctness/security/economics/account/assistant/readiness/auth/routing/payment/research/regression checks passed.
- Worker bundle validation passed.
- `proofttl-web` sprint branch remains at `ce43f9eb4000048547e3451aac836c68da0678dd`; no unrelated web change was introduced.
- Fresh Vercel inspection shows the matching sprint preview and production deployment for `ce43f9eb4000048547e3451aac836c68da0678dd` are both `READY`.

## Finalization review

The substantive diff is intentionally narrow and reversible: one evidence-quality invariant plus one focused regression. No provider interfaces, budgets, public capability claims, or deployment configuration changed. The new rule fails closed only when publication/update chronology is impossible relative to the evidence observation timestamp.

## Remaining highest-value boundary

The major product boundary remains real provider integration into public `/verify`: independent discovery, bounded source retrieval, exact-source semantic evaluation, configured provider pricing, and a genuinely separate adversarial contradiction path must execute through the hardened evidence runtime before receipt-backed automated verification is exposed as a production capability.
