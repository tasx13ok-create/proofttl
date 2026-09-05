# ProofTTL 12-Day Execution Log — Run 13

## 2026-09-05 EVIDENCE EXECUTOR / CONTRADICTION BUDGET COHERENCE CHECKPOINT

### Shipped

- Hardened `src/evidence-executor.js` so an evidence provider cannot be recorded as `COMPLETED` after returning a malformed result. Provider success now requires a non-array object with an explicit `value` field. `null`, primitives, arrays, and objects that omit `value` fail closed as `evidence_provider_result_invalid`.
- Malformed provider success settles the reserved action conservatively as `PROVIDER_ACCOUNTING_INVALID`, withholds the provider output, closes the evidence budget, and prevents later actions from executing on a potentially corrupted receipt chain.
- Preserved an explicit `{ value: null }` as a valid completed provider result. This distinguishes a provider that intentionally found no result from a provider that violated the executor contract.
- Added executor regressions for null, primitive, and missing-value provider returns plus the valid explicit-null case.
- Reassessed the adjacent verification planner and found an internal impossibility: a `PRIMARY_LOOKUP` claim can require an adversarial contradiction pass because of an explicit ambiguity while its execution budget allowed zero contradiction queries.
- Updated `buildEvidencePlan` / `evidenceBudget` so every required contradiction pass has actual contradiction-query capacity. A primary-lookup plan now receives one contradiction query when `contradiction_pass_required` is true; the existing larger depth envelopes remain unchanged.
- Added a regression constructing a low-depth, low-risk ambiguous claim and proving the plan is `VERIFY` + `PRIMARY_LOOKUP` + contradiction-required with `max_contradiction_queries >= 1` and an `ADVERSARIAL_CONTRADICTION` query intent.

### Verification

- Core sprint branch started this pass at `ef3c3c6d2621b904d6d70f9a690cf08c71fcad49`.
- Code/test commits produced during this pass: `aa12ab746d9aabdf76651b0aaf27b78fc63c7898`, `080438140bdc062b8e48e59bedea9a80d57bebc4`, `cbfe4f5b8051783b7504fecbf669010b49f0ac76`, and `a342755f780e3e4e4d30922d38b98003d0d7e90e`.
- GitHub Actions `ProofTTL Code Checks` run `33951489370` completed successfully for code checkpoint `a342755f780e3e4e4d30922d38b98003d0d7e90e`.
- Final diff review from the pass start to the pre-log checkpoint is coherent and reversible: only `src/evidence-executor.js`, `src/verification-plan.js`, their two focused regression files, and this execution log changed.
- `proofttl-web/10xeffort-12-day-sprint` was rechecked against web `main` and remains identical at `ce43f9eb4000048547e3451aac836c68da0678dd`; no cosmetic or unrelated web churn was introduced.

### Remaining

- Public `/verify` still does not execute provenance-preserving independent candidate discovery and a genuinely separate adversarial contradiction retrieval pass through the budgeted evidence executor. The public contract must continue to report those stages as not executed until real provider receipts exist.
- When that integration is added, execution-complete state must be derived only from valid completed executor receipts, not merely from planned actions or provider invocation attempts.
- The next pass should inspect provider-result schemas per action kind (candidate, fetch, semantic, contradiction) so malformed-but-object-shaped payloads cannot cross the generic executor boundary and reach evidence normalization.
