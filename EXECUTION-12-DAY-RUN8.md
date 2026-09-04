# ProofTTL 12-Day Execution Log — Run 8

## Shipped

- Closed the evidence-standard asymmetry where a semantic `CONTRADICTED` source verdict could survive into the evidence ledger without a verbatim source excerpt while `SUPPORTED` was already guarded more strictly.
- Definitive evidence (`FULL_SUPPORT` or `CONTRADICTORY`) now requires both a traceable HTTP(S) source and a non-empty verbatim evidence excerpt in provenance before it can be accepted by the evidence ledger.
- Preserved the provisional source verdict for auditability while forcing the final evidence verdict and public lease status to `UNKNOWN` when definitive evidence lacks the required excerpt.
- Made rejection diagnostics internally consistent: composite quality and final ledger acceptance are now reported separately, preventing rejected high-quality evidence from also claiming `ACCEPTED_FOR_LEDGER`.
- Added verification-context regression coverage for a semantic contradiction with no quote, proving it is rejected and cannot publish a definitive contradiction.
- Updated evidence primitive fixtures to carry explicit verbatim provenance so tests exercise the stronger evidence contract instead of relying on source-less synthetic entailment labels.

## Checkpoints

- `f31e60271c6347633b1fcb2c92001500341148e9` — fail definitive ledger evidence closed without verbatim excerpts.
- `2c8fc441d68090c608e109c1d6c89ebca1f80a94` — add no-quote contradiction regression.
- `5e2694f05cfa3e9e653893c4361c6f97203e119a` — make rejection diagnostics consistent.
- `ed00d34bb4b2940ff0bf0179acd04bbb9c2fe23f` — make verification primitive fixtures provenance-complete after CI exposed stale synthetic assumptions.

## Verification

- The first post-hardening CI pass failed in the core primitive stage because old evidence fixtures asserted definitive support/contradiction without supplying evidence excerpts. That failure was treated as a useful contract regression, not worked around by weakening the new rule.
- After the fixtures were made provenance-complete, ProofTTL Code Checks run `33924174014` passed every stage: core security/limits/economics/lease primitives, commercial/account/platform primitives, assistant/entitlement primitives, readiness/auth/routing/payment/research/regression, and Worker bundle validation.
- `proofttl-web` sprint and `main` were rechecked and remain identical at `ce43f9eb4000048547e3451aac836c68da0678dd`; no web change was justified by this backend correctness pass.

## Remaining flagship boundary

The largest truth-system gap remains unchanged: `/verify` still needs a real provenance-preserving independent-source discovery stage and an actual adversarial contradiction retrieval pass wired into execution. Until that exists, high-assurance verification should continue to fail closed rather than imply multi-source work that did not run.
