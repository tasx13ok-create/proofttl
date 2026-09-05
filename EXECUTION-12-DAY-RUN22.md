# ProofTTL execution log — run 22

Date: 2026-09-05
Branch: `10xeffort-12-day-sprint`
Substantive checkpoint: `572272ee366c1a7ced66df3fbf46d5d9a9897bb4`

## Shipped

Hardened the new evidence orchestrator at the cross-stage provenance boundary before real providers are connected to public `/verify`.

- Every provider-returned source URL now passes ProofTTL's existing public-source safety validator. Discovery can no longer hand a private/local/reserved target to the later fetch stage and bypass the established SSRF boundary.
- `SOURCE_FETCH` results are bound to the candidate that was actually discovered. A provider may report an explicitly requested candidate URL plus a different final URL for a redirect-aware implementation, but an unrelated fetch result fails closed.
- `SEMANTIC_EVALUATION` results are bound to the exact fetched source they were asked to evaluate. A semantic provider can no longer substitute another URL and inherit the original source's discovery provenance.
- Evidence provenance now preserves both `discovery_source_url` and `discovery_provenance`, making the discovery lineage auditable through semantic evaluation.
- Candidate URL normalization/deduplication no longer mutates provider-owned objects; frozen provider results work correctly.
- Public-source safety checks are cached per normalized URL for one orchestration run so the same source is not repeatedly DNS-validated at discovery, fetch, and semantic stages. Distinct URLs are still validated independently.
- Contract failures now carry specific bounded error codes for unsafe URLs, fetch/candidate mismatches, and semantic/source mismatches.

Regression coverage was expanded for frozen provider outputs, unsafe/private candidate rejection, source-fetch substitution, semantic source substitution, provenance lineage, and per-run URL-validation caching.

## Verified

`ProofTTL Code Checks` run `33976825305` passed for checkpoint `572272ee366c1a7ced66df3fbf46d5d9a9897bb4`.

The complete workflow passed:
- core security, limits, economics, and lease primitives
- commercial, account, and platform primitives
- assistant and entitlement primitives
- readiness, auth, routing, payment, research, and regression checks
- Worker bundle validation

Final diff from the prior run head is limited to `src/evidence-orchestrator.js` and `scripts/evidence-orchestrator-test.js` before this log-only commit. The change is localized and reversible.

`proofttl-web` was rechecked and intentionally not changed:
- sprint branch: `ce43f9eb4000048547e3451aac836c68da0678dd`
- `main`: identical to sprint
- matching sprint preview deployment: `READY`
- matching production deployment: `READY`

## Remains

The flagship runtime is now safer to connect, but the public product truth has not been overstated. Public `/verify` still evaluates the caller-provided source and truthfully marks the planned independent evidence runtime as not executed.

Next highest-value integration boundary:
1. implement/configure the real independent candidate-discovery provider;
2. implement bounded source retrieval that reports requested/final source identity explicitly;
3. implement semantic evaluation against the exact fetched source;
4. implement a genuinely separate adversarial contradiction provider;
5. inject real provider pricing/configuration and execute this orchestrator inside public `/verify`;
6. only then allow receipt-backed completed execution to produce definitive automated final verdicts.
