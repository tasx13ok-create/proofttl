# ProofTTL 12-Day Execution — Run 11

## Starting checkpoint

- Core sprint branch started at `015d85a4bbf692b96cae5fec4c7fc0cb957fb838`.
- Web sprint branch remained at `ce43f9eb4000048547e3451aac836c68da0678dd`.

## Highest-value finding

The verification primitives already contained a Claim Contract, triage/evidence planner, budgeted evidence executor, evidence ledger, final outcome semantics, TTL policy, monitor, and reverify path. However, the public `/verify` path still evaluates only the caller-provided `source_url`. Independent candidate discovery and adversarial contradiction retrieval are planned but are not yet executed by the public verification request.

A related product-integrity gap was that persisted leases exposed the Claim Contract and derived verification outcome but did not persist the evidence plan or explicitly record that its retrieval actions had not run. That made the EVIDENCE stage less auditable than the rest of the flagship workflow.

## Shipped

### `65aa3330323d2426ce43bbdc90efc3f312742ae9` — Persist truthful evidence-plan execution state

- `attachImmutableVerificationContext` now derives and persists `evidence_plan` alongside `claim_contract`, `verification_outcome`, and `ttl_policy`.
- The persisted plan records:
  - `execution_status: NOT_EXECUTED_BY_PUBLIC_VERIFY`
  - `executed_action_count: 0`
  - an explicit note that the current public `/verify` path evaluates only the caller-provided source and does not yet execute planned discovery/contradiction actions.
- Evidence-plan derivation is idempotent and logs a bounded `lease_evidence_plan_build_failed` diagnostic if plan construction fails.

### `4c108f29c23d9f44b46c076b0d1a508f2caed1c3` — Test persisted evidence-plan execution boundary

- Added integration assertions that ordinary leases persist an evidence plan with the truthful non-executed status.
- Added high-assurance assertions proving the plan requires a contradiction pass while explicitly recording that the public path has not executed it.
- Extended context idempotence coverage to ensure the evidence plan is not rewritten on repeated enrichment.

### `0f0ae4f1aae4fca55312dec314f69b0c9d1cbdfe` — Reject contradictory evidence stance metadata

- Closed a ledger semantic-integrity hole where explicit `stance` metadata could disagree with the evidence `entailment` and move evidence to the wrong side of the final ledger.
- `FULL_SUPPORT` and `PARTIAL_SUPPORT` now require `stance: FOR`; `CONTRADICTORY` requires `stance: AGAINST`.
- Mismatched items fail closed and receive `REJECTED_STANCE_ENTAILMENT_MISMATCH` instead of contributing to support or contradiction strength.

### `65f4a810667df42bdc5327725c83804211d7965e` — Test stance/entailment fail-closed behavior

- Added regressions proving `FULL_SUPPORT + AGAINST` cannot manufacture a contradiction verdict.
- Added regressions proving `CONTRADICTORY + FOR` cannot manufacture a support verdict.
- Both mismatches remain visible in `rejected_evidence` for auditability.

## Verification

- GitHub Actions `ProofTTL Code Checks` run `33934936053` for code checkpoint `4c108f29c23d9f44b46c076b0d1a508f2caed1c3` completed successfully.
- GitHub Actions `ProofTTL Code Checks` run `33938030947` for semantic-integrity checkpoint `65f4a810667df42bdc5327725c83804211d7965e` completed successfully. Core security/limits/economics/lease primitives, commercial/account/platform primitives, assistant/entitlements, readiness/auth/routing/payment/research/regression, and Worker bundle validation all passed.
- `test:evidence-independence` is already part of `test:local`, so the new semantic mismatch regressions run through the normal predeploy gate.
- Web sprint and web `main` were rechecked and remain identical at `ce43f9eb4000048547e3451aac836c68da0678dd`.
- Vercel deployment inspection confirms the matching sprint preview `dpl_G9gffm5Dka7uMmLyxskp2PwYYGX9` is `READY` and the matching production deployment `dpl_6HELAY62mzgDuNRmQ8KNBCFrAXpK` is `READY` at the same web commit.

## Flagship workflow state

`INPUT → CLAIMS → EVIDENCE → VERDICT → TTL → MONITOR → REVERIFY`

- INPUT: live caller claim + source intake.
- CLAIMS: Claim Contract persisted.
- EVIDENCE: plan is persisted and its actual execution state is explicit; caller-provided source evaluation is live; accepted ledger evidence must now be traceable, definitive evidence must include verbatim proof, publisher-origin independence is bounded, and stance/entailment metadata cannot disagree. Independent discovery/contradiction retrieval is still not live.
- VERDICT: evidence-ledger/fail-closed outcome semantics remain active.
- TTL: advisory TTL policy remains persisted.
- MONITOR: bounded scheduled monitoring remains active.
- REVERIFY: changed-source reverification remains aligned with issuance fail-closed semantics.

## Remaining highest-value work

1. Wire a provenance-preserving candidate-discovery provider into the evidence executor under the plan's query, fetch, cost, and latency ceilings.
2. Wire a distinct adversarial contradiction-query provider/path rather than treating the caller source as a contradiction pass.
3. Route discovered URLs through the existing SSRF/public-source validation before any fetch.
4. Convert completed provider actions into evidence-ledger inputs with observed time, source URL/final URL, publisher origin, verbatim evidence, fingerprint, and claim position.
5. Mark an evidence plan executed only from executor receipts; preserve `UNKNOWN` whenever required work is denied, times out, fails, or remains incomplete.
6. Add end-to-end `/verify` regressions covering multi-source support, genuine contradiction, duplicate/same-publisher evidence, provider failure, budget exhaustion, timeout, and no-discovery cases before advertising independent-source verification as live.
7. Replace hostname-only publisher grouping with explicit publisher-organization identity so sibling subdomains controlled by one organization cannot be mistaken for separate independent origins.

No unsupported capability claim was added in this run.

## Run 11 addendum — evidence latency budget validation

### Finding

The evidence executor now enforces a real plan-wide runtime deadline, but its budget-state validator was asymmetric: query/fetch/evaluation counts and the hard cost ceiling were rejected when malformed, while `latency_budget_ms` was silently coerced with `Math.max(0, Number(value) || 0)`. Missing, negative, non-finite, or fractional latency configuration could therefore become a zero-millisecond deadline and surface as an immediate evidence timeout/budget closure rather than a clear invalid-plan failure.

### `0be44edf52b63ee01cdb82441a948ac9403a70e4` — Fail closed on invalid evidence latency budgets

- `latency_budget_ms` must now be a finite positive integer before any evidence budget state can be created.
- Invalid latency configuration throws `evidence_budget_latency_budget_ms_required` instead of silently turning into a zero-duration execution window.
- Normalization now preserves the validated integer rather than masking bad configuration.

### `465a6888ccf0738ef0adae5f2d9554aafb00d951` — Cover invalid evidence latency budgets

- Added regression coverage for missing, null, zero, negative, fractional, `NaN`, and infinite latency values.
- Added an executor-level assertion proving malformed latency is rejected during construction, before any evidence provider can run.

### Finalization / verification

- Diff is limited to evidence budget validation plus its regression coverage and this execution-log checkpoint; no unrelated product or visual changes were introduced.
- GitHub Actions `ProofTTL Code Checks` run `33940821091` was still in progress for code checkpoint `465a6888ccf0738ef0adae5f2d9554aafb00d951` at finalization, so this addendum does not claim that checkpoint green yet.
- Web sprint and web `main` were rechecked and remain identical at `ce43f9eb4000048547e3451aac836c68da0678dd`.
- The matching web sprint preview `dpl_G9gffm5Dka7uMmLyxskp2PwYYGX9` and production deployment `dpl_6HELAY62mzgDuNRmQ8KNBCFrAXpK` remain `READY`.
- Highest-value remaining product boundary is unchanged: execute provenance-preserving independent candidate discovery and a genuinely distinct adversarial contradiction retrieval pass inside `/verify`, under these now-strict count, cost, and latency ceilings, and only mark the evidence plan complete from actual executor receipts.
