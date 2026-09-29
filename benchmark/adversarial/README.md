# Adversarial verifier release corpus

The corpus contains 145 reviewed fixtures: all 18 attack categories in the integration handoff, source bounds, preserved legacy regressions, question/imperative attacks, and 20 positive controls. It tests the shared verifier without network access and without live model calls.

Each fixture records an expected evidential verdict and a rationale. Cases run with no AI and with an adversarial model mock that returns SUPPORTED with a verbatim excerpt whenever asked. The safe semantic paraphrase control runs only with the mock. The resulting 289 checks verify exact-match behavior, risk handling, evidence attribution, extraction boundaries, and bounded/blocked URL fetches.

A CONTRADICTED fixture may conservatively return UNKNOWN. UNKNOWN is not counted as a correct semantic classification of contradiction. Exact verdict accuracy and UNKNOWN rate are reported separately from the release safety gate. Any false SUPPORTED, false CONTRADICTED, failed positive control, unattached evidence, or exceeded fetch bound fails the gate.

## Cloud execution

Run inside GitHub Actions after checkout with fetch-depth: 0 and npm ci:

~~~sh
node scripts/adversarial-verifier-test.js --baseline-ref c8cf0e4c141b5635675c0ed5eccec2036a725b95 --report benchmark/adversarial/results/before.json --allow-failures
node scripts/adversarial-verifier-test.js --report benchmark/adversarial/results/after.json
node scripts/adversarial-compare.js benchmark/adversarial/results/before.json benchmark/adversarial/results/after.json benchmark/adversarial/results/comparison.json
~~~

The baseline source is loaded through git show into an in-memory module. The runner adds test-only exports and rewrites relative imports; no baseline source files or fixtures are edited. Both reports include the exact corpus digest and verifier source digest. The comparison requires the same fixtures, modes, and expectations, a reproduced baseline false SUPPORTED, zero remaining unsafe supports, and all positive controls passing. Upload the JSON files as Actions artifacts even if a gate fails.

The existing npm run test:adversarial-verifier entry runs this corpus. Original unsafe regression source texts remain unchanged in the legacy_regressions category, and the original clean production assertion remains a positive control.

## Shared API

- deterministicCheck(claim, sourceText) returns a supported result with evidence offsets or null. It never fetches or calls AI.
- verificationContextRisks(claim, sourceText) returns stable risk code strings. Customer snapshot audits can report these as data.
- verifyClaim({ claim, sourceUrl, sourceText, env, allowAi, contextRisks }) is the same public core service; allowAi defaults to true for the legacy public URL path. Known unsafe context returns UNKNOWN before any AI call.

Snapshots supplied by canonical audits must already be bounded and type-validated. HTML/JSON text labeled as plaintext is refused by the shared context guard. The legacy URL path retains safe HTML extraction, carries hidden/quoted/deleted/metadata risks, and refuses truncated evidence.

## Limits

This is a synthetic English corpus and a conservative heuristic guard, not proof of universal truth. Document-wide risk words can produce false UNKNOWN decisions, and exact text can itself be false or copied from an unreliable source. Claims with implicit scope, subtle sarcasm, indirect contradictions, multilingual context, unfamiliar templates, and semantically equivalent numeric units still require stronger evaluation. A clean model-generated paraphrase is still a model judgment; customer-only canonical snapshot audits initially use deterministic evidence.

This suite does not measure live model reliability or token cost, claim extraction/decomposition, cross-source reconciliation, provenance completeness across host uploads, host compatibility, DNS rebinding, or production monitoring. These fields are explicitly unmeasured in its reports. No production deployment is part of these commands.
