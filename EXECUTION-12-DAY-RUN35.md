# ProofTTL 12-Day Sprint — Run 35

## Shipped

- Hardened evidence temporal integrity in `src/evidence-quality.js` so syntactically valid observation timestamps that are more than five minutes in the future are rejected from the verdict-bearing ledger.
- Added explicit `REJECTED_OBSERVATION_IN_FUTURE` provenance reasoning while preserving a five-minute clock-skew tolerance for distributed provider clocks.
- Reused the same assessment instant when `observed_at` is omitted, avoiding multiple wall-clock reads inside one evidence assessment.
- Added `scripts/evidence-temporal-integrity-test.js` with maximum-quality, traceable, verbatim evidence whose publication and observation chronology is internally consistent but occurs in 2099; the regression proves it remains rejected despite a high freshness score.
- Wired the temporal-integrity regression into `test:verification-primitives`, which is already part of `test:local` and therefore the direct `predeploy` gate.

## Verified

- Net diff from prior sprint head `75a1c470988c86cbeef079a1e071479b5da3f0b1` is narrow: `src/evidence-quality.js`, `scripts/evidence-temporal-integrity-test.js`, and one `package.json` test-command line.
- GitHub Actions `ProofTTL Code Checks` run `34013185548` for code checkpoint `9aea4caa815ab36596b1e8ec29d2ef20f9046047` passed every grouped test stage and Worker bundle validation.
- `proofttl-web` sprint and `main` remain identical at `ce43f9eb4000048547e3451aac836c68da0678dd`.
- Fresh Vercel inspection shows the matching sprint preview (`dpl_G9gffm5Dka7uMmLyxskp2PwYYGX9`) and production deployment (`dpl_6HELAY62mzgDuNRmQ8KNBCFrAXpK`) are both `READY` and both correspond to `ce43f9eb4000048547e3451aac836c68da0678dd`.
- The only grouped production runtime error in the last 24 hours remains the existing Node `url.parse()` deprecation warning on `/api/auth-proxy` and `/api/runtime-proxy`; no new web regression was introduced by this backend-only pass.

## Remains

- Bind production source retrieval to the exact freshly validated network destination (or equivalent constrained egress) to close the remaining DNS-rebinding TOCTOU boundary.
- Wire real independent discovery → bounded retrieval → exact-source semantic evaluation → separately executed adversarial contradiction providers into public `/verify` before claiming receipt-backed automated evidence execution.
- Continue auditing temporal metadata semantics, especially how `published_at` versus `updated_at` should be selected when both are present, without granting unsupported freshness.
