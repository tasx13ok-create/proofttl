import assert from "node:assert/strict";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { once } from "node:events";

const root = new URL("./", import.meta.url);
const token = "test-token-that-is-at-least-32-bytes-long";
const apiKey = "mock-provider-key-never-return-this";
const genericModel = "mock-openai-model";
const geminiModel = "gemini-mock-version-001";
const anthropicModel = "claude-mock-version-001";

const mock = createServer(async (req, res) => {
  let body = "";
  for await (const chunk of req) body += chunk;
  const send = value => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(value));
  };
  if (req.url.startsWith("/v1/messages")) return send({ id: "msg_mock", type: "message", role: "assistant", model: anthropicModel, content: [{ type: "text", text: "OK" }], stop_reason: "end_turn", usage: { input_tokens: 1, output_tokens: 1 } });
  if (req.url.startsWith("/v2/chat")) return send({ id: "cohere_mock", model: "cohere-mock-model", message: { role: "assistant", content: [{ type: "text", text: "OK" }] } });
  if (req.url.includes(":generateContent")) return send({ responseId: "gemini-response-mock", modelVersion: geminiModel, candidates: [{ content: { parts: [{ text: "OK" }] } }] });
  if (req.url.includes("/chat/completions")) return send({ id: "chatcmpl_mock", model: genericModel, system_fingerprint: "fp_mock", choices: [{ message: { role: "assistant", content: "OK" } }] });
  res.writeHead(404, { "content-type": "application/json" });
  res.end(JSON.stringify({ error: { message: "unexpected mock route" } }));
});
mock.listen(0, "127.0.0.1");
await once(mock, "listening");
const mockPort = mock.address().port;
const mockBase = `http://127.0.0.1:${mockPort}`;

async function freePort() {
  const server = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}

async function testRequiredBaseUrl() {
  const port = await freePort();
  const env = {
    ...process.env,
    PORT: String(port),
    PROBE_PROVIDER: "vertex-ai",
    PROBE_API_KEY: apiKey,
    PROBE_MODEL_ID: "gemini-test-model",
    PROBE_ACCESS_TOKEN: token,
    PROBE_BASE_URL: ""
  };
  const child = spawn(process.execPath, ["server.mjs"], { cwd: new URL(".", import.meta.url), env, stdio: ["ignore", "ignore", "pipe"] });
  let stderr = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", chunk => { stderr += chunk; });
  const base = `http://127.0.0.1:${port}`;
  try {
    let ready = false;
    for (let i = 0; i < 40; i++) {
      try {
        const response = await fetch(base + "/health", { signal: AbortSignal.timeout(500) });
        if (response.ok) { ready = true; break; }
      } catch {}
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.ok(ready, `vertex-ai missing-base test server starts${stderr ? " — " + stderr : ""}`);
    async function call(name, args = {}) {
      const response = await fetch(base + "/api/mcp", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name, arguments: args } })
      });
      assert.equal(response.status, 200);
      return JSON.parse((await response.json()).result.content[0].text);
    }
    const status = await call("probe_provider_status");
    assert.equal(status.status, "invalid_configuration", "Vertex AI requires a base URL");
    assert.ok(status.required_configuration.includes("PROBE_BASE_URL"), "required base URL disclosed");
    const probe = await call("probe_provider", { access_token: token });
    assert.equal(probe.status, "configuration_error", "missing Vertex AI base URL rejected");
    assert.equal(probe.network_request_made, false, "missing base URL makes no provider request");
  } finally {
    child.kill("SIGTERM");
    await Promise.race([once(child, "exit"), new Promise(resolve => setTimeout(resolve, 1500))]);
  }
}

async function testAdapter(provider, basePath, requestedModel, expectedModel) {
  const port = await freePort();
  const env = {
    ...process.env,
    PORT: String(port),
    PROBE_PROVIDER: provider,
    PROBE_API_KEY: apiKey,
    PROBE_MODEL_ID: requestedModel,
    PROBE_ACCESS_TOKEN: token,
    PROBE_BASE_URL: mockBase + basePath
  };
  const child = spawn(process.execPath, ["server.mjs"], { cwd: new URL(".", import.meta.url), env, stdio: ["ignore", "ignore", "pipe"] });
  let stderr = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", chunk => { stderr += chunk; });
  const base = `http://127.0.0.1:${port}`;
  try {
    let ready = false;
    for (let i = 0; i < 40; i++) {
      try {
        const response = await fetch(base + "/health", { signal: AbortSignal.timeout(500) });
        if (response.ok) { ready = true; break; }
      } catch {}
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.ok(ready, `${provider}: server starts${stderr ? " — " + stderr : ""}`);
    const response = await fetch(base + "/api/mcp", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "probe_provider", arguments: { access_token: token } } })
    });
    assert.equal(response.status, 200, `${provider}: MCP call HTTP status`);
    const rpc = await response.json();
    assert.ok(!rpc.error, `${provider}: MCP protocol error`);
    const data = JSON.parse(rpc.result.content[0].text);
    assert.equal(data.status, "provider_response_metadata_received", `${provider}: metadata received`);
    assert.equal(data.verification.provider, provider, `${provider}: provider label`);
    assert.equal(data.verification.returned_model_id, expectedModel, `${provider}: provider-returned model ID`);
    assert.equal(data.safety.credentials_disclosed, false, `${provider}: credentials not disclosed`);
    assert.ok(!JSON.stringify(data).includes(apiKey), `${provider}: API key not in result`);
    assert.ok(!JSON.stringify(data).includes(token), `${provider}: access token not in result`);
  } finally {
    child.kill("SIGTERM");
    await Promise.race([once(child, "exit"), new Promise(resolve => setTimeout(resolve, 1500))]);
  }
}

try {
  await testRequiredBaseUrl();
  await testAdapter("openai", "/v1", "configured-model", genericModel);
  await testAdapter("openai-compatible", "/v1", "configured-model", genericModel);
  await testAdapter("openrouter", "/v1", "vendor/configured-model", genericModel);
  await testAdapter("xai", "/v1", "configured-model", genericModel);
  await testAdapter("deepseek", "/v1", "configured-model", genericModel);
  await testAdapter("mistral", "/v1", "configured-model", genericModel);
  await testAdapter("groq", "/v1", "configured-model", genericModel);
  await testAdapter("together", "/v1", "configured-model", genericModel);
  await testAdapter("fireworks", "/v1", "configured-model", genericModel);
  await testAdapter("perplexity", "/v1", "configured-model", genericModel);
  await testAdapter("bedrock", "/openai/v1", "amazon-bedrock-model-id", genericModel);
  await testAdapter("cohere", "/v2", "command-r-mock", "cohere-mock-model");
  await testAdapter("vertex-ai", "/v1/projects/test-project/locations/us-central1/publishers/google/models", "gemini-test-model", geminiModel);
  await testAdapter("anthropic", "", "claude-configured-model", anthropicModel);
  await testAdapter("gemini", "/v1beta", "gemini-configured-model", geminiModel);
  await testAdapter("azure-openai", "/openai/deployments/mock-deployment", "mock-deployment", genericModel);
  console.log("PASS: local mock integration tests for OpenAI, OpenAI-compatible, OpenRouter, xAI, DeepSeek, Mistral, Groq, Together, Fireworks, Perplexity, Amazon Bedrock, Cohere, Vertex AI, Anthropic, Gemini, Azure OpenAI; model IDs returned, credentials redacted, no live provider keys or paid API requests used.");
} finally {
  mock.close();
}
