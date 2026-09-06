# ProofTTL 12-Day Sprint — Run 37

## Shipped

- Hardened verdict-bearing evidence strength in `src/evidence-quality.js` so corroboration can only accumulate across independent publishing origins.
- Added a shared `independenceGroupKey()` primitive used by both origin counting and strength weighting, keeping the two concepts consistent instead of reporting one independent group while still stacking every page from that group.
- Multiple accepted pages from the same publisher or publisher host remain visible as separate auditable ledger entries, but only the strongest page from that origin contributes to `support_strength` or `contradiction_strength`.
- This closes a verdict-amplification path where one organization could publish the same modest claim on several pages or sibling subdomains and push aggregate strength over the definitive verdict threshold without independent corroboration.
- Expanded `scripts/evidence-independence-test.js` with a threshold regression proving two modest pages from one explicit publisher remain `UNKNOWN`, while an equally strong second genuinely independent publisher can add enough corroboration to produce `SUPPORTED`.

## Verified

- Code checkpoint `00bbc3b681fae33baddfeff520519af701ac248a` passed GitHub Actions `ProofTTL Code Checks` run `34017998297`.
- Every grouped CI stage passed: core security/limits/economics/lease primitives, commercial/account/platform primitives, assistant/entitlement primitives, readiness/auth/routing/payment/research/regression, and Worker bundle validation.
- The change preserves evidence auditability: same-publisher pages are not deduplicated merely because they share an origin; only their verdict-strength contribution is collapsed to the strongest item per origin.
- `proofttl-web` sprint remains at `ce43f9eb4000048547e3451aac836c68da0678dd`; fresh Vercel inspection confirms sprint preview `dpl_G9gffm5Dka7uMmLyxskp2PwYYGX9` and production `dpl_6HELAY62mzgDuNRmQ8KNBCFrAXpK` are both `READY` on that same web commit.

## Remains

- Reassess confidence coverage next: `deriveConfidence()` still receives total accepted evidence count, so repeated same-origin or non-directional context can increase the coverage component even though it no longer increases verdict strength.
- Revisit URL evidence identity: current deduplication ignores query strings, which is conservative against tracking-parameter amplification but can collapse distinct record-oriented URLs where query parameters identify the actual source object.
- Bind production source retrieval to the exact freshly validated network destination (or equivalent constrained egress) to close the remaining DNS-rebinding TOCTOU boundary.
- Wire real independent discovery → bounded retrieval → exact-source semantic evaluation → separately executed adversarial contradiction providers into public `/verify` before claiming receipt-backed automated evidence execution.
