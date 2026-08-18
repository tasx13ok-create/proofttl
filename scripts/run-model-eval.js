import { spawnSync } from "node:child_process";
import { normalizeAiUsage } from "../src/costs.js";
import { BENCHMARK_MODELS } from "../benchmark/models.js";
import { SEMANTIC_FIXTURES } from "../benchmark/semantic-fixtures.js";

const MIN_ACCURACY = 0.85;
const modelKey = process.argv[2] || "qwen3";
const limitArg = Number.parseInt(process.argv[3] || String(SEMANTIC_FIXTURES.length), 10);
const limit = Number.isFinite(limitArg)
  ? Math.max(1, Math.min(SEMANTIC_FIXTURES.length, limitArg))
  : SEMANTIC_FIXTURES.length;
const model = BENCHMARK_MODELS[modelKey];

console.log(`ProofTTL semantic model benchmark: ${modelKey} (${limit} fixtures)`);
console.log("Transport: direct Cloudflare Workers AI REST API using the current Wrangler authentication session.");
console.log(`Safety gate: >= ${(MIN_ACCURACY * 100).toFixed(0)}% accuracy and ZERO false-SUPPORTED results on non-supported fixtures.\n`);

if (!model) {
  console.error(`Unknown model '${modelKey}'. Allowed: ${Object.keys(BENCHMARK_MODELS).join(", ")}`);
  process.exitCode = 1;
} else {
  try {
    const auth = loadCloudflareAuth();
    const report = await runBenchmark(auth, modelKey, model, limit);
    const gate = printReport(report);
    if (!gate.pass) process.exitCode = 2;
  } catch (error) {
    console.error(`\nMODEL BENCHMARK FAILED: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}

function loadCloudflareAuth() {
  const whoami = runWranglerJson(["whoami", "--json"]);
  if (!whoami?.loggedIn) {
    throw new Error("Wrangler is not authenticated. Run 'npx wrangler login' first.");
  }

  const accounts = Array.isArray(whoami.accounts) ? whoami.accounts : [];
  const requestedAccountId = String(
    process.env.PROOFTTL_ACCOUNT_ID || process.env.CLOUDFLARE_ACCOUNT_ID || ""
  ).trim();

  let account;
  if (requestedAccountId) {
    account = accounts.find((item) => item?.id === requestedAccountId);
    if (!account) {
      throw new Error("The configured Cloudflare account ID is not available to the current Wrangler session.");
    }
  } else if (accounts.length === 1) {
    account = accounts[0];
  } else if (accounts.length === 0) {
    throw new Error("Wrangler authentication returned no accessible Cloudflare accounts.");
  } else {
    throw new Error(
      "Wrangler has access to multiple Cloudflare accounts. Set PROOFTTL_ACCOUNT_ID to the account ID that owns ProofTTL, then rerun the benchmark."
    );
  }

  const credentials = runWranglerJson(["auth", "token", "--json"]);
  if (!credentials?.type) {
    throw new Error("Wrangler did not return usable authentication credentials.");
  }

  if (credentials.type === "api_key") {
    if (!credentials.key || !credentials.email) {
      throw new Error("Wrangler returned incomplete API key credentials.");
    }
    return {
      accountId: account.id,
      headers: {
        "X-Auth-Key": credentials.key,
        "X-Auth-Email": credentials.email
      }
    };
  }

  if (!credentials.token) {
    throw new Error("Wrangler returned an authentication record without a token.");
  }

  return {
    accountId: account.id,
    headers: { Authorization: `Bearer ${credentials.token}` }
  };
}

function runWranglerJson(args) {
  const isWindows = process.platform === "win32";
  const command = isWindows ? (process.env.ComSpec || process.env.COMSPEC || "cmd.exe") : "npx";
  const commandArgs = isWindows
    ? ["/d", "/s", "/c", `npx.cmd wrangler ${args.join(" ")}`]
    : ["wrangler", ...args];

  const result = spawnSync(command, commandArgs, {
    cwd: process.cwd(),
    env: process.env,
    encoding: "utf8",
    windowsHide: true,
    maxBuffer: 1024 * 1024
  });

  if (result.error) {
    throw new Error(`Could not start Wrangler: ${result.error.message}`);
  }
  if (result.status !== 0) {
    const detail = String(result.stderr || result.stdout || "Wrangler command failed").trim();
    throw new Error(`Wrangler authentication command failed: ${detail.slice(-1000)}`);
  }

  try {
    return JSON.parse(String(result.stdout || "").trim());
  } catch {
    throw new Error("Wrangler returned non-JSON authentication output.");
  }
}

async function runBenchmark(auth, key, modelConfig, fixtureLimit) {
  const cases = [];
  let passed = 0;
  let promptTokens = 0;
  let completionTokens = 0;
  let usageMissing = 0;
  const startedAt = Date.now();

  for (const fixture of SEMANTIC_FIXTURES.slice(0, fixtureLimit)) {
    const result = await runFixture(auth, modelConfig, fixture);
    cases.push(result);
    if (result.pass) passed += 1;
    if (result.usage) {
      promptTokens += result.usage.prompt_tokens || 0;
      completionTokens += result.usage.completion_tokens || 0;
    } else {
      usageMissing += 1;
    }
  }

  const estimatedCostUsd = usageMissing === 0
    ? estimateBenchmarkCost(modelConfig, promptTokens, completionTokens)
    : null;

  return {
    model_key: key,
    model_id: modelConfig.id,
    total: cases.length,
    passed,
    accuracy: cases.length ? passed / cases.length : 0,
    usage: {
      prompt_tokens: promptTokens,
      completion_tokens: completionTokens,
      cases_missing_usage: usageMissing
    },
    estimated_ai_cost_usd: estimatedCostUsd,
    elapsed_ms: Date.now() - startedAt,
    cases
  };
}

async function runFixture(auth, modelConfig, fixture) {
  const schema = {
    type: "object",
    properties: {
      status: { type: "string", enum: ["SUPPORTED", "CONTRADICTED", "UNKNOWN"] },
      evidence: { type: ["string", "null"] },
      reason: { type: "string" },
      confidence: { type: "number", minimum: 0, maximum: 1 }
    },
    required: ["status", "evidence", "reason", "confidence"],
    additionalProperties: false
  };

  const system = [
    "You are ProofTTL's conservative textual-entailment verifier.",
    "Use ONLY SOURCE TEXT; never use outside knowledge.",
    "Compare the exact factual proposition in CLAIM against SOURCE TEXT.",
    "SUPPORTED only if every material attribute in CLAIM matches the source: entity, value, number, unit, date/time, polarity, qualifier, direction, and scope.",
    "If the source states the same subject with a different value, return CONTRADICTED.",
    "UNKNOWN means missing, ambiguous, conditional, stale-looking, or insufficient.",
    "Evidence must be a short exact substring copied verbatim from SOURCE TEXT.",
    "Never label a claim SUPPORTED merely because the source discusses the same subject. Prefer UNKNOWN over guessing."
  ].join(" ");

  const messages = [
    { role: "system", content: system },
    { role: "user", content: `CLAIM:\n${fixture.claim}\n\nSOURCE TEXT:\n${fixture.source}` }
  ];

  const aiRequest = {
    messages,
    max_tokens: 300,
    temperature: 0
  };

  if (modelConfig.jsonSchema) {
    aiRequest.response_format = {
      type: "json_schema",
      json_schema: {
        name: "proofttl_benchmark_verdict",
        strict: true,
        schema
      }
    };
  } else {
    messages[0].content += " Return ONLY one JSON object with keys status, evidence, reason, confidence. No markdown.";
  }

  try {
    const endpoint = `https://api.cloudflare.com/client/v4/accounts/${auth.accountId}/ai/run/${modelConfig.id}`;
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        ...auth.headers,
        "content-type": "application/json"
      },
      body: JSON.stringify(aiRequest)
    });

    const envelope = await response.json().catch(() => null);
    if (!response.ok || envelope?.success === false) {
      const apiError = envelope?.errors?.[0]?.message || envelope?.messages?.[0]?.message || `HTTP ${response.status}`;
      return failure(fixture, "ERROR", `workers_ai_api_error: ${apiError}`, null);
    }

    const raw = envelope?.result ?? envelope;
    const usage = normalizeAiUsage(raw?.usage ?? raw?.result?.usage ?? envelope?.usage);
    const parsed = parseModelResponse(raw);

    if (!parsed || !["SUPPORTED", "CONTRADICTED", "UNKNOWN"].includes(parsed.status)) {
      return failure(fixture, "ERROR", "invalid_model_output", usage);
    }

    const evidence = typeof parsed.evidence === "string" ? parsed.evidence.trim() : null;
    if (evidence && !fixture.source.includes(evidence)) {
      return failure(fixture, "ERROR", "non_verbatim_evidence", usage);
    }

    return {
      id: fixture.id,
      expected: fixture.expected,
      actual: parsed.status,
      pass: parsed.status === fixture.expected,
      evidence,
      reason: String(parsed.reason || ""),
      confidence: Number(parsed.confidence) || 0,
      usage
    };
  } catch (error) {
    return failure(
      fixture,
      "ERROR",
      error instanceof Error ? error.message : String(error),
      null
    );
  }
}

function failure(fixture, actual, reason, usage) {
  return {
    id: fixture.id,
    expected: fixture.expected,
    actual,
    pass: false,
    evidence: null,
    reason,
    confidence: 0,
    usage
  };
}

function parseModelResponse(result) {
  if (!result) return null;
  if (typeof result === "object" && result.status) return result;
  const candidate = result.response ?? result.result ?? result.output_text ?? result;
  if (typeof candidate === "object" && candidate.status) return candidate;
  if (typeof candidate !== "string") return null;

  try {
    return JSON.parse(candidate);
  } catch {
    const match = candidate.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      return JSON.parse(match[0]);
    } catch {
      return null;
    }
  }
}

function estimateBenchmarkCost(modelConfig, promptTokens, completionTokens) {
  const inputRate = Number(modelConfig.inputUsdPerMillionTokens);
  const outputRate = Number(modelConfig.outputUsdPerMillionTokens);
  if (!Number.isFinite(inputRate) || !Number.isFinite(outputRate)) return null;
  return (promptTokens * inputRate + completionTokens * outputRate) / 1_000_000;
}

function printReport(report) {
  console.log(`Model: ${report.model_id}`);
  console.log(`Score: ${report.passed}/${report.total} (${(report.accuracy * 100).toFixed(1)}%)`);
  console.log(`Prompt tokens: ${Number(report.usage?.prompt_tokens || 0).toLocaleString()}`);
  console.log(`Completion tokens: ${Number(report.usage?.completion_tokens || 0).toLocaleString()}`);
  console.log(`Cases missing usage: ${report.usage?.cases_missing_usage || 0}`);
  console.log(`Estimated benchmark AI cost: ${report.estimated_ai_cost_usd === null ? "unknown" : `$${Number(report.estimated_ai_cost_usd).toFixed(8)}`}`);
  console.log(`Elapsed: ${report.elapsed_ms}ms`);

  const failures = report.cases.filter((item) => !item.pass);
  const falseSupported = report.cases.filter(
    (item) => item.expected !== "SUPPORTED" && item.actual === "SUPPORTED"
  );
  const enoughAccuracy = report.accuracy >= MIN_ACCURACY;
  const noDangerousFalseSupport = falseSupported.length === 0;
  const pass = enoughAccuracy && noDangerousFalseSupport;

  console.log(`Dangerous false-SUPPORTED results: ${falseSupported.length}`);
  console.log(`QUALITY GATE: ${pass ? "PASS" : "FAIL"}`);

  if (failures.length === 0) {
    console.log("\nALL FIXTURES PASSED.");
  } else {
    console.log("\nFailures:");
    for (const item of failures) {
      console.log(`- ${item.id}: expected ${item.expected}, got ${item.actual}`);
      console.log(`  reason: ${item.reason}`);
    }
  }

  if (falseSupported.length > 0) {
    console.log("\nHARD SAFETY FAILURES:");
    for (const item of falseSupported) {
      console.log(`- ${item.id}: ${item.expected} was incorrectly labeled SUPPORTED`);
    }
  }

  return { pass, enoughAccuracy, noDangerousFalseSupport };
}
