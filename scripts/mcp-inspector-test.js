import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startMcpCiServer } from "./mcp-ci-server.js";
import { createMcpTestToken } from "./mcp-test-helpers.js";

const temporary = await mkdtemp(join(tmpdir(), "proofttl-inspector-"));
const instance = await startMcpCiServer();
const secrets = [instance.token, instance.env.PROOFTTL_MCP_AUTH_SECRET, instance.env.PROOFTTL_SIGNING_PRIVATE_JWK];
const redact = value => secrets.reduce((text, secret) => secret ? text.split(secret).join("[REDACTED]") : text, String(value));
const processEnv = {
  ...process.env,
  MCP_AUTO_OPEN_ENABLED: "false",
  MCP_STORAGE_DIR: temporary,
  MCP_CATALOG_PATH: join(temporary, "catalog.json"),
  MCP_CLIENT_CONFIG_PATH: join(temporary, "client.json"),
  MCP_INSPECTOR_OAUTH_STATE_PATH: join(temporary, "oauth.json"),
  NO_PROXY: "127.0.0.1,localhost"
};
function run(program, args, timeoutMs = 120000) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.platform === "win32" ? program + ".cmd" : program, args, { env: processEnv, stdio: ["ignore", "pipe", "pipe"], shell: false });
    let stdout = ""; let stderr = ""; let tooLarge = false;
    const collect = (value, isError) => {
      if (stdout.length + stderr.length + value.length > 4 * 1024 * 1024) { tooLarge = true; child.kill("SIGTERM"); return; }
      if (isError) stderr += value; else stdout += value;
    };
    child.stdout.on("data", chunk => collect(chunk.toString(), false));
    child.stderr.on("data", chunk => collect(chunk.toString(), true));
    const timer = setTimeout(() => child.kill("SIGTERM"), timeoutMs);
    child.once("error", error => { clearTimeout(timer); reject(new Error(redact(error.message))); });
    child.once("close", (code, signal) => {
      clearTimeout(timer);
      if (code !== 0 || tooLarge) reject(new Error("Inspector process failed (code=" + code + ", signal=" + signal + "): " + redact(stderr || stdout).slice(0, 3000)));
      else resolve({ stdout: redact(stdout), stderr: redact(stderr) });
    });
  });
}
function parseOutput(stdout) {
  const value = stdout.trim();
  try { return JSON.parse(value); } catch {}
  // Older Inspector releases may prepend a banner. Find the final complete JSON object.
  for (let index = value.indexOf("{"); index >= 0; index = value.indexOf("{", index + 1)) {
    try { return JSON.parse(value.slice(index)); } catch {}
  }
  throw new Error("Inspector did not return a JSON result.");
}
const claim = "The catalog contains seven entries.";
const sources = [{ kind: "text", text: claim, label: "Inspector CI catalog" }];
const executed = [];
try {
  // Resolve latest from npm in CI, then execute that exact version for reproducibility.
  const versionOutput = await run("npm", ["view", "@modelcontextprotocol/inspector@latest", "version", "--json"]);
  const inspectorVersion = JSON.parse(versionOutput.stdout.trim());
  assert.match(inspectorVersion, /^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/);
  const packageSpec = "@modelcontextprotocol/inspector@" + inspectorVersion;
  const help = await run("npx", ["--yes", packageSpec, "--cli", "--help"]);
  const helpText = help.stdout + help.stderr;
  const jsonFormat = helpText.includes("--format");
  const jsonArgs = helpText.includes("--tool-args-json");
  async function invoke(method, name, args) {
    const freshToken = await createMcpTestToken(instance.env, { sub: "ci_inspector" });
    secrets.push(freshToken);
    const command = ["--yes", packageSpec, "--cli", instance.url, "--transport", "http", "--method", method, "--header", "Authorization: Bearer " + freshToken];
    if (jsonFormat) command.push("--format", "json");
    if (name) command.push("--tool-name", name);
    if (args) {
      if (jsonArgs) command.push("--tool-args-json", JSON.stringify(args));
      else for (const [key, value] of Object.entries(args)) command.push("--tool-arg", key + "=" + (typeof value === "string" ? value : JSON.stringify(value)));
    }
    const output = await run("npx", command);
    const parsed = parseOutput(output.stdout);
    const result = parsed.result ?? parsed;
    assert.equal(result.isError, undefined, name || method);
    assert.equal(result.error, undefined, name || method);
    executed.push({ method, ...(name ? { tool: name } : {}), structured_result: Boolean(result.structuredContent), exit_code: 0 });
    return result.structuredContent || result;
  }
  const list = await invoke("tools/list");
  assert.deepEqual(list.tools.map(tool => tool.name).sort(), ["audit_claim", "audit_output", "challenge_claim", "compare_evidence", "create_fact_lease", "get_fact_lease"].sort());
  for (const tool of list.tools) assert.equal(tool.inputSchema.additionalProperties, false);
  const audit = await invoke("tools/call", "audit_claim", { claim, sources, source_policy: "customer_only" });
  assert.equal(audit.verdict, "SUPPORTED"); assert.equal(audit.lease_eligible, true);
  const outputAudit = await invoke("tools/call", "audit_output", { output_text: claim, sources, source_policy: "customer_only" });
  assert.ok(outputAudit.claim_results.length);
  const challenged = await invoke("tools/call", "challenge_claim", { audit_id: audit.audit_id, claim_result_id: audit.claim_result_id });
  assert.equal(challenged.audit_mutated, false);
  const comparison = await invoke("tools/call", "compare_evidence", { audit_id: audit.audit_id });
  assert.ok(comparison.claim_results.length);
  const leaseArgs = { audit_id: audit.audit_id, claim_result_id: audit.claim_result_id, ttl_seconds: 300, idempotency_key: "inspector-" + crypto.randomUUID() };
  const lease = await invoke("tools/call", "create_fact_lease", leaseArgs);
  assert.equal(lease.signature.algorithm, "Ed25519");
  const retry = await invoke("tools/call", "create_fact_lease", leaseArgs);
  assert.equal(retry.lease_id, lease.lease_id);
  const read = await invoke("tools/call", "get_fact_lease", { lease_id: lease.lease_id });
  assert.equal(read.signature_verified, true);
  assert.equal(read.monitoring.status, "NOT_REGISTERED");
  const evidence = {
    suite: "official-mcp-inspector",
    inspector_package: packageSpec,
    latest_resolved_in_ci: true,
    executed_at: new Date().toISOString(),
    transport: "Streamable HTTP stateless JSON",
    endpoint: "ephemeral loopback CI bridge",
    initialization: "executed by official CLI connection for every invocation",
    authentication: "generated in-process tenant JWT",
    storage: "real SQLite with canonical D1 migration",
    executed,
    idempotency: { lease_id: lease.lease_id, retry_same_id: true },
    signature_verified: true,
    native_provider_hosts: "NOT EXECUTED",
    cross_request_cancellation: "NOT SUPPORTED",
    oauth: "NOT SUPPORTED"
  };
  const directory = process.env.PROOFTTL_MCP_CI_EVIDENCE_DIR || "artifacts";
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, "mcp-inspector.json"), JSON.stringify(evidence, null, 2) + "\n", { mode: 0o600 });
  console.log(JSON.stringify(evidence));
} finally {
  await instance.close();
  await rm(temporary, { recursive: true, force: true });
}
