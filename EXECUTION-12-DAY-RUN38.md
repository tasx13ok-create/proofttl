# ProofTTL 12-Day Sprint — Run 38

## Shipped

- Hardened `deriveConfidence()` so confidence coverage is based on distinct directional publishing origins rather than total accepted evidence count.
- Repeated same-publisher support/refutation can no longer raise confidence merely by adding more pages after verdict strength has already been collapsed to the strongest item from that origin.
- Accepted `CONTEXT_ONLY` / `UNKNOWN` evidence remains visible and auditable, but no longer manufactures non-zero verdict confidence when there is no directional evidence.
- Hardened URL evidence identity so normalized query parameters participate in deduplication. Distinct record-oriented URLs such as `?id=100` and `?id=101` remain distinct evidence objects instead of being collapsed solely because hostname/path match.
- Query parameter ordering is canonicalized before identity comparison, so semantically identical URLs with reordered parameters still deduplicate.
- Added `scripts/evidence-identity-confidence-test.js` covering same-origin confidence amplification, context-only confidence, distinct query-identified records, and reordered-query deduplication.
- Wired the new regression into `test:local` via `test:evidence-identity-confidence`.

## Verified

- Focused local regression passed against the exact modified `src/evidence-quality.js` before shipping.
- Final substantive code checkpoint `a5d3da83931d00e5d3f0a301b556ffcea87a9a0f` passed GitHub Actions `ProofTTL Code Checks` run `34020766018`.
- Every grouped CI stage passed: core security/limits/economics/lease primitives, commercial/account/platform primitives, assistant/entitlement primitives, readiness/auth/routing/payment/research/regression, and Worker bundle validation.
- Diff from Run 37 checkpoint `9dacfe38c3f056000a2c7a960d02a923dd554b3a` is narrow and reversible: `src/evidence-quality.js` (+10/-5), one focused 74-line regression, and `package.json` (+2/-1) before this execution-log commit.
- `proofttl-web` sprint remains unchanged at `ce43f9eb4000048547e3451aac836c68da0678dd`.
- Fresh Vercel inspection confirms sprint preview `dpl_G9gffm5Dka7uMmLyxskp2PwYYGX9` and production `dpl_6HELAY62mzgDuNRmQ8KNBCFrAXpK` are both `READY` on web commit `ce43f9eb4000048547e3451aac836c68da0678dd`.

## Remains

- Bind production source retrieval to the exact freshly validated network destination (or equivalent constrained egress) to close the remaining DNS-rebinding TOCTOU boundary.
- Wire real independent discovery → bounded retrieval → exact-source semantic evaluation → separately executed adversarial contradiction providers into public `/verify` before claiming receipt-backed automated evidence execution.
- Reassess URL canonicalization when real providers are wired: tracking/session parameters may warrant an explicit allow/deny canonicalization policy, but record-identifying query parameters must not be erased by default.
- Continue reviewing confidence semantics alongside the public receipt/UI so `UNKNOWN` plus contextual evidence cannot be presented with misleadingly verdict-like certainty.
