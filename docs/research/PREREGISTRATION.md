# Reality Runtime falsification protocol

Status: registered before simulator execution, 2026-09-30. Research only.

## Repository boundary

Repository: `tasx13ok-create/proofttl`. Read directly from GitHub and git refs:

| Protected reference | Observed SHA | State |
| --- | --- | --- |
| main | 8647171d56b44fe6bc3a608fa8a4df6c7233e87e | default branch |
| PR #22 / codex/universal-proof-engine | 5f8c2028cab8b81acc139dc074b7ec9e41392e2d | open draft; base feature/software-first-core |
| PR #23 / codex/live-host-auth | 721dad000c3445b85f1b433b37b176ad70b3678c | open draft; base codex/universal-proof-engine |

Research branch: `research/reality-runtime-falsification`, forked from the exact PR #22 SHA above. No modification of those references, PR metadata, production code, migrations, dependencies, deployment configuration, credentials, or deployed services is part of this experiment. The new cloud workflow has read-only repository permissions and no deployment step or secrets.

The accessible prior conversation gives the mixed exact/coverage dependency hypothesis, immutable observations, deterministic fold, QuestionKey/assertion separation and strong B+ baseline. It does **not** provide the complete original audit or numerical kill thresholds. The numerical gates below are newly registered engineering decision thresholds, not recovered quotations or validated production requirements. No claim of architectural novelty is made.

## Hypotheses and controls

H1: span/context reuse can avoid extraction work caused by cosmetic whole-page changes.

H2: an explicitly typed mixed exact/coverage runtime provides an additional benefit over a strong B+ implementation with the same information.

H3: finite evidence dependencies cannot certify absence of unseen open-world contradictions; TTL bounds re-observation scheduling, not truth.

Compare three implementations:

- PAGE: whole-page hash plus coverage freshness. A reference illustrating page-level invalidation, not a claim to reproduce the legacy service.
- B_PLUS: value-independent QuestionKey; tenant/universe isolation; span and context hashes; extraction/canonicalizer/policy versions; negative-coverage TTL; all the same available provider, query-policy, watermark and push signals as MIXED.
- MIXED: explicit exact and coverage dependency objects, immutable observations and a deterministic fold. No privileged oracle, extra discovery signals, extra sources, cheaper cost weights or greater TTL than B_PLUS.

All strategies get identical generated event streams and fixed extraction observations. Generators are seeded, and model nondeterminism is represented by immutable generated observations rather than paid inference. Identity is structural and conservative: numeric/categorical typed questions only; ambiguity remains UNKNOWN. Assertions with different values can share an evidence state; different tenant, evidence universe, entity, attribute, unit, effective time, scope, type or interpretation versions cannot.

## Workloads and measurement

Use at least five fixed seeds and multiple families containing stable pages, cosmetic changes, changed qualifiers with an unchanged evidence span, factual updates, delayed/unseen contradiction, retrieval failure, coverage expiry at equality, provider/query/watermark/push changes, conflicts and copied-source lineage. Include multiple assertions/providers and identity collision traps. Fix workload definitions before first execution; any later correction must be disclosed as a protocol amendment.

Record per strategy and trial: requests, fetches, retrieval calls, extraction calls, folds, reuse, retained serialized bytes, false SUPPORTED/CONTRADICTED against an independent observed-evidence oracle, and separate stale/incorrect answers against the full simulated world. Record hidden-contradiction exposure and refresh lag in simulated time. Full-world knowledge must never enter a runtime cache key or invalidation signal. An unchanged observed snapshot can legitimately disagree with the current world; that disagreement is reported rather than relabeled safe.

Report operation counts and modeled cost using extraction/retrieval cost sensitivity weights 1, 10 and 100. These are arbitrary dimensionless work proxies, not measured dollars, real inference latency, real provider reliability or production throughput. Report wall-clock execution only as CI instrumentation. Serialized byte counts are not a production storage benchmark. Repeated seeds are workload variation, not independent population evidence or statistical confidence intervals.

## Hard safety kills

Any of the following rejects a candidate for production consideration:

1. A result diverges from the independent full recomputation of the *available immutable observations* when reuse is valid, or returns a stronger conclusion after required invalidation without refresh.
2. Tenant/universe leakage, false identity merge, changed context/version accepted as unchanged, or use of host/model verdict as authority.
3. A stored observation changes during replay, deterministic replay changes with ordering, or a conflict/copy count creates unsupported certainty.
4. Expired/failed coverage is silently treated as proof that no contradiction exists.
5. Existing canonical audit/MCP/adversarial regression gates fail, or changes escape the research allowlist.

Independent-world errors within a still-valid incomplete coverage interval are exposure, not automatically a cache implementation bug. They must be visible and must not increase relative to B+.

## Benefit and complexity kills

To justify further optimization work, MIXED must reduce modeled expensive work by at least **20% relative to B_PLUS in every registered seed and cost sensitivity**, with no worse false-result count, hidden-contradiction exposure or refresh lag, and no hard safety violation. A win only against PAGE is insufficient. The strict all-trial threshold is an engineering hurdle, not a statistical test.

If B_PLUS and MIXED have equivalent observable behavior and operation counts, reject the additional runtime machinery as an optimization. Keep the experiment, the authority boundary and the representation lessons; do not implement a production optimization merely to complete a narrative. If results are inconclusive, preserve them and specify the next discriminating experiment.

Passing this simulator is necessary but insufficient for production. Real source acquisition/context completeness, extraction recall, nondeterministic retrieval, concurrent durability, tenant authorization, native-host behavior and operational economics are outside this model. Any later production proposal requires separate evidence and must still load/revalidate the server-owned audit before lease issuance. Never connect this research module to the signing, lease, HTTP or MCP production paths.

## Evidence and decision

GitHub Actions on the research branch is authoritative. Preserve the executed head SHA, preregistration SHA/hash, Node/runner metadata, fixed configuration, workload hash, JSON results, test logs, scope guard and unchanged production regression outcomes as artifacts. CI success means the falsification procedure completed; it does not imply the optimization survived. Record rejected hypotheses as valid research results.
