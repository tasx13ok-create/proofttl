import { readFile, mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { performance } from "node:perf_hooks";

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
const corpusPath = new URL("../benchmark/adversarial/fixtures.json", import.meta.url);
const corePath = new URL("../src/index.js", import.meta.url);
const args = process.argv.slice(2);
function option(name) {
  const at = args.indexOf(name);
  if (at < 0) return null;
  if (!args[at + 1] || args[at + 1].startsWith("--")) throw new Error("Missing argument: " + name);
  return args[at + 1];
}
const baseline = option("--baseline-ref");
const reportPath = option("--report");
const allowFailures = args.includes("--allow-failures");
const sha256 = (value) => createHash("sha256").update(value).digest("hex");

async function loadCore() {
  if (!baseline) return { module: await import(corePath.href), code: await readFile(corePath, "utf8") };
  if (!/^[a-f0-9]{40}$/i.test(baseline)) throw new Error("--baseline-ref must be a complete immutable commit SHA");
  const original = execFileSync("git", ["show", baseline + ":src/index.js"], { cwd: repositoryRoot, encoding: "utf8" });
  // No baseline files are changed. Only the in-memory module gains test exports
  // and absolute import URLs, so the same corpus can exercise the original code.
  const transformed = original.replace(/from "(\.\/[^"]+)"/g, (_match, path) => "from " + JSON.stringify(new URL(path, corePath).href)) +
    "\nexport { verifyClaim, deterministicCheck };\n";
  return { module: await import("data:text/javascript;base64," + Buffer.from(transformed).toString("base64")), code: original };
}

async function evaluate(module, fixture, mode) {
  let aiCalls = 0;
  let fetches = 0;
  const mockEvidence = fixture.mock_evidence ?? (fixture.source.includes(fixture.claim) ? fixture.claim : fixture.source);
  const env = {
    ...(fixture.max_source_chars ? { PROOFTTL_MAX_SOURCE_CHARS: fixture.max_source_chars } : {}),
    ...(mode === "hostile_semantic" ? { AI: { async run() {
      aiCalls += 1;
      return { status: "SUPPORTED", evidence: mockEvidence, reason: "malicious_mock_always_supports", confidence: 0.99 };
    } } } : {})
  };
  const startedAt = performance.now();
  let verdict;
  let httpStatus = null;
  let directResult = null;

  if (fixture.transport !== "http") {
    directResult = module.deterministicCheck(fixture.claim, fixture.source);
    verdict = await module.verifyClaim({
      claim: fixture.claim,
      sourceUrl: "https://8.8.8.8/source",
      sourceText: fixture.source,
      env
    });
  } else {
    const originalFetch = globalThis.fetch;
    const originalLog = console.log;
    globalThis.fetch = async () => {
      fetches += 1;
      if (Object.hasOwn(fixture, "redirect")) {
        return new Response(null, { status: 302, headers: fixture.redirect ? { location: fixture.redirect } : {} });
      }
      return new Response(fixture.source, {
        status: 200,
        headers: { "content-type": fixture.content_type || "text/plain; charset=utf-8", ...fixture.headers }
      });
    };
    console.log = () => {};
    try {
      const response = await module.default.fetch(new Request("https://proofttl.test/verify", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ claim: fixture.claim, source_url: fixture.source_url || "https://8.8.8.8/source", ttl_seconds: 300 })
      }), env);
      httpStatus = response.status;
      const body = await response.json();
      verdict = { ...body, status: body.status || "UNKNOWN", reason: body.reason || body.error || "" };
    } finally {
      globalThis.fetch = originalFetch;
      console.log = originalLog;
    }
  }

  const falseSupported = fixture.expected !== "SUPPORTED" && verdict.status === "SUPPORTED";
  const falseContradicted = fixture.expected !== "CONTRADICTED" && verdict.status === "CONTRADICTED";
  const supportControlFailed = fixture.expected === "SUPPORTED" && verdict.status !== "SUPPORTED";
  const directFalseSupported = fixture.expected !== "SUPPORTED" && directResult?.status === "SUPPORTED";
  const boundedFetches = fixture.max_fetches === undefined || fetches <= fixture.max_fetches;
  const evidenceInSource = verdict.status !== "SUPPORTED" || (
    typeof verdict.evidence === "string" && fixture.source.includes(verdict.evidence)
  );
  const reasons = [];
  if (falseSupported) reasons.push("false_SUPPORTED");
  if (falseContradicted) reasons.push("false_CONTRADICTED");
  if (supportControlFailed) reasons.push("support_control_failed");
  if (directFalseSupported) reasons.push("direct_check_false_SUPPORTED");
  if (!boundedFetches) reasons.push("source_fetch_bound_failed");
  if (!evidenceInSource) reasons.push("evidence_not_attributable");
  return {
    fixture_id: fixture.id,
    category: fixture.category,
    mode,
    expected: fixture.expected,
    actual: verdict.status,
    pass: reasons.length === 0,
    exact_verdict_match: fixture.expected === verdict.status,
    failures: reasons,
    reason: verdict.reason || "",
    verifier: verdict.verifier || null,
    evidence: verdict.evidence || null,
    direct_check: directResult?.status || null,
    evidence_attributable: evidenceInSource,
    context_risks: typeof module.verificationContextRisks === "function" ? module.verificationContextRisks(fixture.claim, fixture.source) : [],
    ai_calls: aiCalls,
    fetches,
    http_status: httpStatus,
    latency_ms: Number((performance.now() - startedAt).toFixed(3))
  };
}

async function run() {
  const corpusText = await readFile(corpusPath, "utf8");
  const corpus = JSON.parse(corpusText);
  const fixtures = corpus.fixtures;
  if (!Array.isArray(fixtures) || fixtures.length < 100) throw new Error("Adversarial corpus must have at least 100 fixtures");
  const ids = new Set();
  for (const fixture of fixtures) {
    if (ids.has(fixture.id)) throw new Error("Duplicate fixture id: " + fixture.id);
    ids.add(fixture.id);
    if (!fixture.category || !fixture.rationale || typeof fixture.claim !== "string" || typeof fixture.source !== "string" ||
        !["SUPPORTED", "CONTRADICTED", "UNKNOWN"].includes(fixture.expected)) throw new Error("Invalid fixture: " + fixture.id);
  }
  const { module, code } = await loadCore();
  const cases = [];
  const startedAt = Date.now();
  for (const fixture of fixtures) {
    for (const mode of fixture.modes || ["deterministic_only", "hostile_semantic"]) {
      cases.push(await evaluate(module, fixture, mode));
    }
  }
  const statuses = { SUPPORTED: 0, CONTRADICTED: 0, UNKNOWN: 0 };
  const categories = {};
  for (const result of cases) {
    statuses[result.actual] += 1;
    const item = categories[result.category] ||= { checks: 0, false_supported: 0, failed: 0 };
    item.checks += 1;
    if (result.failures.includes("false_SUPPORTED")) item.false_supported += 1;
    if (!result.pass) item.failed += 1;
  }
  const failures = cases.filter((result) => !result.pass);
  const controls = cases.filter((result) => result.expected === "SUPPORTED");
  const summary = {
    fixture_count: fixtures.length,
    check_count: cases.length,
    passed: cases.length - failures.length,
    failed: failures.length,
    false_supported: cases.filter((result) => result.failures.includes("false_SUPPORTED")).length,
    false_contradicted: cases.filter((result) => result.failures.includes("false_CONTRADICTED")).length,
    direct_false_supported: cases.filter((result) => result.failures.includes("direct_check_false_SUPPORTED")).length,
    support_controls: controls.length,
    support_controls_passed: controls.filter((result) => result.actual === "SUPPORTED").length,
    exact_verdict_accuracy: cases.filter((result) => result.exact_verdict_match).length / cases.length,
    unknown_rate: statuses.UNKNOWN / cases.length,
    status_counts: statuses,
    ai_calls: cases.reduce((sum, result) => sum + result.ai_calls, 0),
    elapsed_ms: Date.now() - startedAt
  };
  const report = {
    schema_version: 1,
    suite: "ProofTTL adversarial verifier",
    verifier_ref: baseline || "working-tree",
    verifier_sha256: sha256(code),
    corpus_sha256: sha256(corpusText),
    generated_at: new Date().toISOString(),
    execution: { model: "local_malicious_mock", real_model_evaluation: false, external_network: false },
    gate_policy: "Non-SUPPORTED cases may conservatively abstain; every support control and evidence/fetch invariant must pass.",
    summary,
    categories,
    cases,
    unmeasured: ["real_model_accuracy", "claim_extraction_recall", "decomposition_accuracy", "host_tool_success", "real_model_token_cost", "cross_source_provenance"]
  };
  if (reportPath) {
    const absolute = resolve(reportPath);
    await mkdir(dirname(absolute), { recursive: true });
    await writeFile(absolute, JSON.stringify(report, null, 2) + "\n");
  }
  console.log(JSON.stringify({ ...summary, report: reportPath || null, false_supported_ids: cases.filter((result) => result.failures.includes("false_SUPPORTED")).map((result) => result.fixture_id + ":" + result.mode) }, null, 2));
  if (failures.length && !allowFailures) process.exitCode = 1;
}

run().catch((error) => {
  console.error("ADVERSARIAL VERIFIER TEST FAILED:", error.stack || error.message);
  process.exitCode = 1;
});
