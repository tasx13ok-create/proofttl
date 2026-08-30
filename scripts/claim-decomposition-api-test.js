import assert from "node:assert/strict";
import {
  DEFAULT_MAX_DECOMPOSE_REQUEST_BYTES,
  handleClaimDecompositionRequest
} from "../src/claim-decomposition-api.js";

let checks = 0;
async function check(name, fn) {
  await fn();
  checks += 1;
  console.log(`ok ${checks} - ${name}`);
}

await check("claim decomposition API returns deterministic preflight contracts", async () => {
  const request = new Request("https://example.test/claims/decompose", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      text: "Acme reported $42 million in revenue in 2025. Acme currently supports SAML SSO on its Pro plan. I think the product is amazing.",
      max_claims: 10
    })
  });

  const response = await handleClaimDecompositionRequest(request, {
    nowMs: Date.parse("2026-08-30T12:00:00Z")
  });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.stage, "CLAIMS");
  assert.equal(body.mode, "DETERMINISTIC_PREFLIGHT");
  assert.equal(body.claim_count, 2);
  assert.equal(body.skipped_count, 1);
  assert.equal(body.claims[1].claim_contract.volatility.level, "HIGH");
  assert.equal(body.execution.external_calls, 0);
  assert.equal(body.execution.model_calls, 0);
  assert.equal(body.execution.billable_verification_started, false);
});

await check("claim decomposition API rejects non-JSON bodies loudly", async () => {
  const request = new Request("https://example.test/claims/decompose", {
    method: "POST",
    headers: { "content-type": "text/plain" },
    body: "Acme was founded in 2018."
  });
  const response = await handleClaimDecompositionRequest(request);
  assert.equal(response.status, 415);
  const body = await response.json();
  assert.equal(body.error, "json_content_type_required");
});

await check("claim decomposition API rejects oversized bodies before parsing", async () => {
  const oversized = "x".repeat(DEFAULT_MAX_DECOMPOSE_REQUEST_BYTES + 1);
  const request = new Request("https://example.test/claims/decompose", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: oversized
  });
  const response = await handleClaimDecompositionRequest(request);
  assert.equal(response.status, 413);
  const body = await response.json();
  assert.equal(body.error, "request_body_too_large");
});

await check("claim decomposition API exposes the 30k character contract explicitly", async () => {
  const request = new Request("https://example.test/claims/decompose", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text: `Acme ${"x".repeat(30010)} is available.` })
  });
  const response = await handleClaimDecompositionRequest(request);
  assert.equal(response.status, 413);
  const body = await response.json();
  assert.equal(body.error, "claim_decomposition_input_too_long");
  assert.equal(body.max_chars, 30000);
});

await check("claim decomposition API refuses empty input instead of inventing claims", async () => {
  const request = new Request("https://example.test/claims/decompose", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text: "   " })
  });
  const response = await handleClaimDecompositionRequest(request);
  assert.equal(response.status, 400);
  const body = await response.json();
  assert.equal(body.error, "claim_decomposition_input_required");
});

console.log(`SUCCESS: ${checks} claim decomposition API checks passed.`);
