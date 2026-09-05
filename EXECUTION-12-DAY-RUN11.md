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

## Verification

- GitHub Actions `ProofTTL Code Checks` run `33934936053` for code checkpoint `4c108f29c23d9f44b46c076b0d1a508f2caed1c3` completed successfully.
- `test:verification-context` remains part of `test:local`, so this boundary is exercised by the normal predeploy gate rather than by an orphan test.
- Web sprint and web `main` were rechecked and are identical at `ce43f9eb4000048547e3451aac836c68da0678dd`; no unrelated UI churn was introduced.

## Flagship workflow state

`INPUT → CLAIMS → EVIDENCE → VERDICT → TTL → MONITOR → REVERIFY`

- INPUT: live caller claim + source intake.
- CLAIMS: Claim Contract persisted.
- EVIDENCE: plan is now persisted and its actual execution state is explicit; caller-provided source evaluation is live, but independent discovery/contradiction retrieval is not yet live.
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

No unsupported capability claim was added in this run.
