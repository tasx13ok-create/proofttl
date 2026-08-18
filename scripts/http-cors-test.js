import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  API_CORS,
  applyApiCors,
  apiCorsPreflightResponse
} from "../src/http-cors.js";

let checks = 0;
function check(name, fn) {
  fn();
  checks += 1;
  console.log(`ok ${checks} - ${name}`);
}

const paymentRequired = "eyJ4NDAyVmVyc2lvbiI6Mn0=";
const paymentResponse = "eyJzdWNjZXNzIjp0cnVlfQ==";

const wrapped402 = applyApiCors(
  new Response(JSON.stringify({ error: "payment_required" }), {
    status: 402,
    headers: {
      "content-type": "application/json",
      "payment-required": paymentRequired,
      "retry-after": "60"
    }
  })
);

check("preserves response status", () => {
  assert.equal(wrapped402.status, 402);
});

check("preserves PAYMENT-REQUIRED header", () => {
  assert.equal(wrapped402.headers.get("payment-required"), paymentRequired);
});

check("allows browser origin", () => {
  assert.equal(wrapped402.headers.get("access-control-allow-origin"), "*");
});

check("allows x402 payment signature request header", () => {
  const value = wrapped402.headers.get("access-control-allow-headers") || "";
  assert.match(value, /Payment-Signature/i);
});

check("allows JSON content type request header", () => {
  const value = wrapped402.headers.get("access-control-allow-headers") || "";
  assert.match(value, /Content-Type/i);
});

check("exposes x402 payment challenge header", () => {
  const value = wrapped402.headers.get("access-control-expose-headers") || "";
  assert.match(value, /Payment-Required/i);
});

check("exposes x402 payment settlement header", () => {
  const value = wrapped402.headers.get("access-control-expose-headers") || "";
  assert.match(value, /Payment-Response/i);
});

check("exposes retry-after header", () => {
  const value = wrapped402.headers.get("access-control-expose-headers") || "";
  assert.match(value, /Retry-After/i);
});

check("sets reusable preflight cache duration", () => {
  assert.equal(
    wrapped402.headers.get("access-control-max-age"),
    String(API_CORS.maxAge)
  );
});

const wrapped402Body = await wrapped402.clone().json();
check("preserves response body", () => {
  assert.equal(wrapped402Body.error, "payment_required");
});

const wrappedSettlement = applyApiCors(
  new Response("ok", {
    status: 200,
    headers: { "payment-response": paymentResponse }
  })
);

check("preserves PAYMENT-RESPONSE header", () => {
  assert.equal(wrappedSettlement.headers.get("payment-response"), paymentResponse);
});

const preflight = apiCorsPreflightResponse();

check("preflight returns 204", () => {
  assert.equal(preflight.status, 204);
});

check("preflight allows GET POST OPTIONS", () => {
  assert.equal(
    preflight.headers.get("access-control-allow-methods"),
    "GET, POST, OPTIONS"
  );
});

const workerSource = await readFile(new URL("../src/worker.js", import.meta.url), "utf8");
const wranglerSource = await readFile(new URL("../wrangler.jsonc", import.meta.url), "utf8");

check("Worker fetch path applies outer CORS wrapper", () => {
  assert.match(workerSource, /applyApiCors\(response\)/);
});

check("Worker handles browser preflight before payment middleware", () => {
  assert.match(workerSource, /request\.method === "OPTIONS"/);
  assert.match(workerSource, /apiCorsPreflightResponse\(\)/);
});

check("Worker preserves scheduled monitoring delegation", () => {
  assert.match(workerSource, /entry\.scheduled\(controller, env, ctx\)/);
});

check("Wrangler deploys the CORS wrapper entrypoint", () => {
  assert.match(wranglerSource, /"main"\s*:\s*"src\/worker\.js"/);
});

console.log(`\n${checks} HTTP CORS checks passed.`);
