import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const [beforePath, afterPath, outputPath] = process.argv.slice(2);
if (!beforePath || !afterPath) throw new Error("Usage: node scripts/adversarial-compare.js before.json after.json [comparison.json]");
const before = JSON.parse(await readFile(beforePath, "utf8"));
const after = JSON.parse(await readFile(afterPath, "utf8"));
const failures = [];
const check = (condition, reason) => { if (!condition) failures.push(reason); };
check(before.corpus_sha256 === after.corpus_sha256, "before_after_corpus_digest_differs");
check(before.summary.fixture_count === after.summary.fixture_count && after.summary.fixture_count >= 100, "corpus_count_changed_or_too_small");
check(before.summary.check_count === after.summary.check_count, "before_after_check_count_differs");
check(before.summary.false_supported > 0, "baseline_did_not_reproduce_false_SUPPORTED");
check(after.summary.false_supported === 0, "known_false_SUPPORTED_remains");
check(after.summary.direct_false_supported === 0, "direct_exact_match_false_SUPPORTED_remains");
check(after.summary.false_contradicted === 0, "false_CONTRADICTED_remains");
check(after.summary.failed === 0, "other_adversarial_invariants_failed");
check(after.summary.support_controls >= 30 && after.summary.support_controls_passed === after.summary.support_controls, "support_was_disabled_or_positive_controls_failed");
const keys = (report) => report.cases.map((item) => [item.fixture_id, item.mode, item.expected].join(":")).sort();
check(JSON.stringify(keys(before)) === JSON.stringify(keys(after)), "fixture_expectations_or_modes_changed");
const report = {
  schema_version: 1,
  pass: failures.length === 0,
  failures,
  corpus_sha256: after.corpus_sha256,
  before_verifier_ref: before.verifier_ref,
  before_verifier_sha256: before.verifier_sha256,
  after_verifier_ref: after.verifier_ref,
  after_verifier_sha256: after.verifier_sha256,
  before: before.summary,
  after: after.summary,
  resolved_false_supported: before.cases.filter((item) => item.failures.includes("false_SUPPORTED")).map((item) => ({
    fixture_id: item.fixture_id,
    mode: item.mode,
    before: item.actual,
    after: after.cases.find((candidate) => candidate.fixture_id === item.fixture_id && candidate.mode === item.mode)?.actual || null
  })),
  limitation: "Conservative abstention and malicious mock guard tests; this is not a real-model or cross-host accuracy claim."
};
if (outputPath) {
  const absolute = resolve(outputPath);
  await mkdir(dirname(absolute), { recursive: true });
  await writeFile(absolute, JSON.stringify(report, null, 2) + "\n");
}
console.log(JSON.stringify(report, null, 2));
if (failures.length) process.exitCode = 1;
