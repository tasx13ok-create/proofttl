# ProofTTL 12-Day Sprint — Run 39

## Shipped

- Hardened evidence independence so corroboration is no longer keyed by a single provider-controlled publisher string.
- Independence now uses alias-aware connected groups over both normalized publisher identity and exact source hostname.
- Two pages on the same hostname with different publisher labels cannot manufacture separate corroboration groups or stack verdict strength.
- Sibling hostnames that declare the same publisher still collapse to one publishing origin.
- Publisher/hostname relationships merge transitively, closing bridge cases where inconsistent provider labels could otherwise split one real publishing organization into multiple verdict-bearing origins.
- `sideStrength()`, independent support/contradiction counts, and directional confidence coverage now share the same origin-grouping primitive.
- Added regression coverage for same-host conflicting publisher labels and transitive publisher/hostname aliasing while preserving existing independent-publisher behavior.

## Verified

- Substantive checkpoint `036ee01d8f4108e7ea7033f28fee861948af313a` passed GitHub Actions `ProofTTL Code Checks` run `34023632882`.
- Every grouped CI stage passed: core security/limits/economics/lease primitives, commercial/account/platform primitives, assistant/entitlement primitives, readiness/auth/routing/payment/research/regression, and Worker bundle validation.
- The checkpoint is one fast-forward commit from Run 38 head `ce22bc2a3813b86939047f654579b40a67828ade` and changes only `src/evidence-quality.js` and `scripts/evidence-independence-test.js` before this execution-log commit.
- `proofttl-web` sprint and `main` remain identical at `ce43f9eb4000048547e3451aac836c68da0678dd`.
- Fresh Vercel inspection confirms sprint preview `dpl_G9gffm5Dka7uMmLyxskp2PwYYGX9` and production `dpl_6HELAY62mzgDuNRmQ8KNBCFrAXpK` are both `READY` on that web commit.
- Fresh 24-hour Vercel runtime inspection still shows only the existing Node `url.parse()` deprecation warning on `/api/auth-proxy` and `/api/runtime-proxy`; no new runtime error class was introduced.

## Remains

- Publisher normalization is still string-based. Real provider integration should prefer a trustworthy publisher/entity identifier when available, while retaining hostname aliasing as a fail-closed guard against provider label drift.
- Bind production source retrieval to the exact freshly validated network destination (or equivalent constrained egress) to close the remaining DNS-rebinding TOCTOU boundary.
- Wire real independent discovery → bounded retrieval → exact-source semantic evaluation → separately executed adversarial contradiction providers into public `/verify` before claiming receipt-backed automated evidence execution.
- Reassess URL canonicalization when real providers are wired so tracking/session parameters can be removed without erasing record-identifying query parameters.
