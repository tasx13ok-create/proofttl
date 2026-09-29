import { createServer } from "node:http";
import { Readable } from "node:stream";
import { pathToFileURL } from "node:url";
import { handleMcpRequest } from "../src/mcp/handler.js";
import { createMcpTestEnv } from "./mcp-test-helpers.js";

// Ephemeral CI-only bridge. Uses actual service + actual SQLite D1 schema.
// It never loads deployed credentials and only listens on the loopback interface.
export async function startMcpCiServer({ port = 0 } = {}) {
  const fixture = await createMcpTestEnv({ tenantId: "ci_inspector" });
  let origin;
  const server = createServer(async (incoming, outgoing) => {
    const controller = new AbortController();
    incoming.once("aborted", () => controller.abort());
    outgoing.once("close", () => { if (!outgoing.writableEnded) controller.abort(); });
    try {
      const url = new URL(incoming.url || "/", origin);
      if (url.pathname !== "/mcp") { outgoing.writeHead(404); outgoing.end(); return; }
      const headers = new Headers();
      for (const [name, value] of Object.entries(incoming.headers)) {
        if (Array.isArray(value)) for (const item of value) headers.append(name, item);
        else if (value !== undefined) headers.set(name, value);
      }
      const method = incoming.method || "GET";
      const request = new Request(url, {
        method, headers, signal: controller.signal,
        ...(!["GET", "HEAD"].includes(method) ? { body: Readable.toWeb(incoming), duplex: "half" } : {})
      });
      const response = await handleMcpRequest(request, fixture.env);
      outgoing.writeHead(response.status, Object.fromEntries(response.headers));
      outgoing.end(response.body ? Buffer.from(await response.arrayBuffer()) : undefined);
    } catch {
      if (!outgoing.headersSent) outgoing.writeHead(500, { "content-type": "application/json" });
      outgoing.end('{"error":"ci_bridge_failed"}');
    }
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolve);
  });
  origin = "http://127.0.0.1:" + server.address().port;
  return {
    url: origin + "/mcp",
    token: fixture.token,
    env: fixture.env,
    async close() {
      await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
      fixture.close();
    }
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const instance = await startMcpCiServer({ port: Number(process.env.PROOFTTL_MCP_TEST_PORT) || 8789 });
  console.log(JSON.stringify({ endpoint: instance.url, storage: "ephemeral-real-sqlite", credentials: "generated-in-process" }));
  for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, () => {
    void instance.close().then(() => process.exit(0), () => process.exit(1));
  });
}
