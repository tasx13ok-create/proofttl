# ProofTTL execution addendum — sustained pass 6

## Shipped

- Hardened the legacy KV-only automatic monitor so its per-run cap is based on attempted due reverifications, not only successful checks.
- Added `attempted` to the monitor summary so operators can distinguish work attempted from work completed.
- Kept `checked` as the successful-completion counter and `errors` as the failed-attempt counter.
- Added a regression that seeds 25 due leases, forces every lease persistence step to throw, and proves only 10 source/reverification attempts are made.
- Wired the regression into both `npm run test:local` and the `ProofTTL Code Checks` GitHub Actions workflow.

## Why this matters

The previous loop stopped only when `checked >= 10`, but `checked` incremented after a successful `reverifyLease`. Repeated exceptions could therefore cause one scheduled KV monitor pass to attempt far more than the advertised ten checks, increasing source-fetch and failure pressure during an outage. The new `attempted` envelope is incremented immediately before each due reverification and is the hard stop condition.

## Verification state

- Code commits: `eb150845f298269a3ba023c23f7be168d367402a`, `0379445a47215dedaaab2a5da559003259aee190`, `d837d98eaf251435f48c2a01f1094cf721ab8123`, `ffdf19c849f7fd8747767f2c0a113e980ca2adda`.
- CI is expected to run on pushes to `10xeffort-12-day-sprint`; final workflow status should be checked before calling this checkpoint green.

## Remaining high-value boundary

The flagship `/verify` path still needs real provenance-preserving independent source discovery plus an actual adversarial contradiction retrieval pass. Until that execution stage exists, high-assurance verification must continue to fail closed rather than imply multi-source verification ran when it did not.
