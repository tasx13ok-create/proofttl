# ProofTTL 12-Day Execution — Run 33

Date: 2026-09-05
Branch: `10xeffort-12-day-sprint`

## Shipped

- Closed a stale source-safety authorization gap in `src/evidence-orchestrator.js`: discovery-time DNS validation is no longer reused as the authorization for a later `SOURCE_FETCH` network action.
- The exact selected candidate URL is now revalidated immediately before the `SOURCE_FETCH` provider is invoked. If the source has become unsafe between discovery and retrieval, the fetch action fails closed and the provider never runs.
- Kept normalized-URL validation caching only inside the discovery stage so duplicate URLs returned across multiple query intents do not cause redundant DNS work. Fetch-stage validation deliberately bypasses that cache and is always fresh.
- Preserved exact fetch-to-candidate and semantic-to-fetched-source URL bindings; the new prefetch check strengthens the network boundary without weakening provenance or source identity checks.
- Added a deterministic rebinding regression that accepts a source during discovery, makes it resolve unsafe at the prefetch check, and verifies that the `SOURCE_FETCH` provider receives zero calls, the action fails, and the verification remains `UNKNOWN`.
- Recorded the remaining transport-level requirement explicitly: a production fetch transport still needs to connect only to the freshly validated address set, or use equivalent controlled egress, to completely eliminate validation-to-connect DNS-rebinding TOCTOU.

## Verification

- The first broad uncaching attempt intentionally went through CI and did not pass the core gate; review showed the scope was too broad because identical URLs discovered by multiple query intents were being revalidated unnecessarily.
- Narrowed caching to discovery only while leaving fetch-stage validation uncached.
- Final code-bearing checkpoint: `2e8e80ff9e32ab7b35a02ba9371f05a8d806df9c`.
- GitHub Actions `ProofTTL Code Checks` run `34008098347`: completed successfully.
- Core security, limits, economics, lease, verification, evidence budget/executor/runtime/orchestrator, execution-summary, plan-binding, verification-context, decomposition, discovery-signing, and event-signing checks passed.
- Commercial, account, and platform primitive checks passed.
- Assistant and entitlement primitive checks passed.
- Readiness, auth, routing, payment, research, regression, and release checks passed.
- Worker bundle validation passed.

## Deployment / drift check

- `proofttl-web` sprint remains at `ce43f9eb4000048547e3451aac836c68da0678dd`; no unrelated web change was introduced in this pass.
- Fresh Vercel inspection shows sprint preview deployment `dpl_G9gffm5Dka7uMmLyxskp2PwYYGX9` is `READY` on `ce43f9eb4000048547e3451aac836c68da0678dd`.
- Fresh Vercel inspection shows production deployment `dpl_6HELAY62mzgDuNRmQ8KNBCFrAXpK` is `READY` on the same commit.
- Fresh 24-hour runtime-error aggregation still shows only the existing Node `DEP0169` `url.parse()` deprecation-warning group on `/api/auth-proxy` and `/api/runtime-proxy`; no new application request-failure cluster surfaced.

## Finalization review

The code-bearing diff from the previous sprint head `7230d29c4e8b992e2e82a500d627d9e882b23eb5` is intentionally narrow: `src/evidence-orchestrator.js` and `scripts/evidence-orchestrator-test.js`. The implementation is reversible, leaves discovery deduplication efficiency intact, and strengthens the exact point where a candidate becomes a real retrieval action. The final code checkpoint passed the full CI workflow before this log was added.

## Remaining highest-value boundary

The immediate transport-security boundary is to make the real source-fetch implementation connect only to the freshly validated address set (or equivalent constrained egress) rather than performing an unconstrained second DNS lookup inside the provider.

The major product boundary remains production provider integration into public `/verify`: independent discovery, bounded retrieval, exact-source semantic evaluation, configured provider pricing, and a genuinely separate adversarial contradiction path still need to execute through the hardened evidence runtime before receipt-backed automated verification is exposed as a production capability.
