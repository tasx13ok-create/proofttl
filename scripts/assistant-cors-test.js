import assert from "node:assert/strict";
import {
  applyAssistantCors,
  assistantPreflightResponse,
  isTrustedAssistantOrigin
} from "../src/assistant-cors.js";

let checks = 0;
function check(name, fn) {
  fn();
  checks += 1;
  console.log(`ok ${checks} - ${name}`);
}

const env = {
  PROOFTTL_AUTH_TRUSTED_ORIGINS: "https://proofttl-web-git-main-tasx13ok-1769s-projects.vercel.app"
};

const trustedRequest = new Request("https://proofttl.tasx13ok.workers.dev/assistant/text", {
  method: "POST",
  headers: { origin: "https://proofttl-web-git-main-tasx13ok-1769s-projects.vercel.app" }
});

const untrustedRequest = new Request("https://proofttl.tasx13ok.workers.dev/assistant/text", {
  method: "POST",
  headers: { origin: "https://evil.example" }
});

check("recognizes configured trusted assistant origin", () => {
  assert.equal(isTrustedAssistantOrigin(trustedRequest, env), true);
});

check("does not trust arbitrary assistant origin", () => {
  assert.equal(isTrustedAssistantOrigin(untrustedRequest, env), false);
});

const trusted = applyAssistantCors(new Response("ok"), trustedRequest, env);
check("trusted browser gets reflected origin", () => {
  assert.equal(
    trusted.headers.get("access-control-allow-origin"),
    "https://proofttl-web-git-main-tasx13ok-1769s-projects.vercel.app"
  );
});

check("trusted browser gets credential support", () => {
  assert.equal(trusted.headers.get("access-control-allow-credentials"), "true");
});

check("trusted browser response varies by Origin", () => {
  assert.match(trusted.headers.get("vary") || "", /Origin/i);
});

const untrusted = applyAssistantCors(new Response("ok"), untrustedRequest, env);
check("untrusted browser retains anonymous wildcard access", () => {
  assert.equal(untrusted.headers.get("access-control-allow-origin"), "*");
});

check("untrusted browser never receives credential support", () => {
  assert.equal(untrusted.headers.get("access-control-allow-credentials"), null);
});

check("assistant CORS allows content type and authorization", () => {
  const value = trusted.headers.get("access-control-allow-headers") || "";
  assert.match(value, /Content-Type/i);
  assert.match(value, /Authorization/i);
});

check("assistant CORS exposes Retry-After", () => {
  assert.match(trusted.headers.get("access-control-expose-headers") || "", /Retry-After/i);
});

const preflight = assistantPreflightResponse(trustedRequest, env);
check("trusted assistant preflight returns 204", () => {
  assert.equal(preflight.status, 204);
});

check("trusted assistant preflight supports credentials", () => {
  assert.equal(preflight.headers.get("access-control-allow-credentials"), "true");
});

console.log(`\n${checks} assistant CORS checks passed.`);
