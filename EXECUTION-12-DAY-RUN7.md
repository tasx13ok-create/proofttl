# ProofTTL sustained engineering pass — run 7

## Shipped

- Hardened `src/evidence-quality.js` so evidence cannot enter the accepted verdict ledger unless `source_url` resolves to a traceable HTTP(S) URL with a hostname.
- Added explicit ledger reasons for `TRACEABLE_HTTP_SOURCE` and `REJECTED_UNTRACEABLE_SOURCE` so provenance rejection is inspectable rather than implicit.
- Added verification-primitives regressions proving that a high-scoring source label such as `internal-memory-only` is rejected and cannot manufacture a `SUPPORTED` ledger verdict or an independent-support group.

## Why this matters

ProofTTL's evidence scoring previously allowed a malformed, missing, or non-web `source_url` to remain eligible for acceptance if its quality inputs were strong enough. That violates the product's source-backed contract: an evidence item that cannot be traced back to an inspectable source must not contribute to a definitive verdict. The ledger now fails closed before strength, corroboration, and confidence aggregation.

## Verification

- `test:verification-primitives` is part of the repository's `test:local`/predeploy gate.
- ProofTTL Code Checks for code checkpoint `8830178e8da37d0066ab2baba8950bed23c940cc` completed successfully: core security/limits/economics/lease primitives, commercial/account/platform primitives, assistant/entitlement primitives, readiness/auth/routing/payment/research/regression/release checks, and Worker bundle validation all passed.
- `proofttl-web` sprint and `main` remain identical at `ce43f9eb4000048547e3451aac836c68da0678dd`; no unrelated visual churn was introduced.

## Remaining truth boundaries / next targets

1. `/verify` still needs real provenance-preserving independent source discovery and an actual adversarial contradiction retrieval pass before ProofTTL can truthfully claim multi-source verification is executed end to end.
2. The semantic verifier currently enforces verbatim evidence for `SUPPORTED`, but a model-originated `CONTRADICTED` verdict can still survive with no verbatim evidence excerpt. That asymmetry should be closed so either definitive direction requires inspectable source text.
3. Continue checking adjacent evidence-ledger boundaries for malformed provenance, duplicate-source independence inflation, and invalid final-outcome inputs, then run the full gate and Worker bundle validation after each coherent change.
