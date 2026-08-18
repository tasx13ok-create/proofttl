import { spawn } from "node:child_process";

const MIN_ACCURACY = 0.85;
const model = process.argv[2] || "qwen3";
const limitArg = Number.parseInt(process.argv[3] || "14", 10);
const limit = Number.isFinite(limitArg) ? Math.max(1, Math.min(14, limitArg)) : 14;
const port = 8790;
const baseUrl = `http://127.0.0.1:${port}`;
const npx = process.platform === "win32" ? "npx.cmd" : "npx";

console.log(`ProofTTL semantic model benchmark: ${model} (${limit} fixtures)`);
console.log("Workers AI runs remotely even though the benchmark Worker is local.");
console.log(`Safety gate: >= ${(MIN_ACCURACY * 100).toFixed(0)}% accuracy and ZERO false-SUPPORTED results on non-supported fixtures.\n`);

const child = spawn(
  npx,
  [
    "wrangler",
    "dev",
    "--config",
    "wrangler.model-eval.jsonc",
    "--port",
    String(port),
    "--local"
  ],
  {
    cwd: process.cwd(),
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"]
  }
);

let startupOutput = "";
child.stdout.on("data", (chunk) => {
  startupOutput += chunk.toString();
});
child.stderr.on("data", (chunk) => {
  startupOutput += chunk.toString();
});

let finished = false;

try {
  await waitUntilReady();
  const response = await fetch(`${baseUrl}/run`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model, limit })
  });

  const body = await response.json();
  if (!response.ok) {
    throw new Error(`benchmark HTTP ${response.status}: ${JSON.stringify(body)}`);
  }

  const gate = printReport(body);
  finished = true;
  if (!gate.pass) process.exitCode = 2;
} catch (error) {
  console.error(`\nMODEL BENCHMARK FAILED: ${error instanceof Error ? error.message : String(error)}`);
  if (startupOutput.trim()) {
    console.error("\nWrangler output:\n" + startupOutput.trim().slice(-6000));
  }
  process.exitCode = 1;
} finally {
  stopChild();
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

  return {
    pass,
    enoughAccuracy,
    noDangerousFalseSupport,
    dangerousFalseSupported: falseSupported.length
  };
}

async function waitUntilReady() {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (child.exitCode !== null) {
      throw new Error(`Wrangler exited during startup with code ${child.exitCode}`);
    }

    try {
      const response = await fetch(`${baseUrl}/`);
      if (response.ok) return;
    } catch {
      // Local Worker has not bound the port yet.
    }

    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  throw new Error("local benchmark Worker did not become ready");
}

function stopChild() {
  if (child.exitCode !== null || child.killed) return;
  child.kill(process.platform === "win32" ? undefined : "SIGTERM");

  // Windows sometimes leaves the Wrangler child process behind when only the
  // npm/npx wrapper receives a signal. Best-effort cleanup of the process tree.
  if (process.platform === "win32" && child.pid) {
    const killer = spawn("taskkill", ["/pid", String(child.pid), "/t", "/f"], {
      stdio: "ignore",
      windowsHide: true
    });
    killer.unref();
  }
}

process.on("SIGINT", () => {
  stopChild();
  if (!finished) process.exitCode = 130;
});
