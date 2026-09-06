# ProofTTL 12-Day Sprint — Run 36

## Shipped

- Hardened `src/evidence-quality.js` so `published_at` and `updated_at` are treated as separate provenance claims instead of collapsing them with `published_at || updated_at`.
- A malformed `updated_at` can no longer hide behind a valid `published_at`; it now fails closed with `REJECTED_INVALID_UPDATE_TIMESTAMP`.
- Added chronology enforcement that rejects updates occurring before publication (`REJECTED_UPDATE_BEFORE_PUBLICATION`) and updates occurring after the evidence observation (`REJECTED_UPDATE_AFTER_OBSERVATION`).
- Preserved both normalized `published_at` and `updated_at` in assessed evidence instead of overwriting one with the other.
- Freshness now uses the valid update timestamp when present, otherwise the publication timestamp, while acceptance remains contingent on every supplied timestamp being valid and chronologically coherent.
- Expanded `scripts/evidence-temporal-integrity-test.js` to cover malformed update timestamps, update-before-publication, update-after-observation, valid publication/update chronology, and the prior future-observation invariant.

## Verified

- Net substantive diff from prior sprint head `cebc0d58edacffea333a81f91d5ae104b68c7a2c` is confined to `src/evidence-quality.js` and `scripts/evidence-temporal-integrity-test.js` (2 commits, 2 files).
- GitHub Actions `ProofTTL Code Checks` run `34015402482` for code checkpoint `e40f022bd5a39978db731319457099f0e6d3b581` passed every grouped stage: core security/limits/economics/lease primitives, commercial/account/platform primitives, assistant/entitlement primitives, readiness/auth/routing/payment/research/regression, and Worker bundle validation.
- Final source review confirms the scorer independently validates publication/update syntax and chronology, retains both normalized fields, and does not grant ledger acceptance merely because the selected freshness timestamp is high.
- `proofttl-web` sprint and `main` remain identical at `ce43f9eb4000048547e3451aac836c68da0678dd`.
- Fresh Vercel inspection shows the matching sprint preview `dpl_G9gffm5Dka7uMmLyxskp2PwYYGX9` and production deployment `dpl_6HELAY62mzgDuNRmQ8KNBCFrAXpK` are both `READY` and correspond to that same web commit.
- Production runtime aggregation for the last 24 hours still shows only the existing Node `url.parse()` deprecation warning on `/api/auth-proxy` and `/api/runtime-proxy`; no web deployment regression was introduced by this backend-only pass.

## Remains

- Bind production source retrieval to the exact freshly validated network destination (or equivalent constrained egress) to close the remaining DNS-rebinding TOCTOU boundary.
- Wire real independent discovery → bounded retrieval → exact-source semantic evaluation → separately executed adversarial contradiction providers into public `/verify` before claiming receipt-backed automated evidence execution.
- Continue auditing evidence identity and temporal semantics for conservative failure behavior, especially provider metadata that can describe mirrors, revisions, and source-origin lineage.
