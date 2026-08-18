import {
  DEFAULT_MAX_VERIFY_REQUEST_BYTES,
  getVerifyRateLimitKey,
  readResponseTextLimited,
  validateVerifyRequest
} from "../src/limits.js";

let passed = 0;

function assert(condition, message) {
  if (!condition) throw new Error(message);
  passed += 1;
  console.log(`PASS ${passed}: ${message}`);
}

async function run() {
  console.log("ProofTTL request/source limit regression test\n");

  const challengeRequest = new Request("https://proofttl.test/verify", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ claim: "Example Domain", source_url: "https://example.com" })
  });
  assert(
    getVerifyRateLimitKey(challengeRequest) === "verify:challenge",
    "unpaid requests use the challenge limiter bucket"
  );

  const paidAttemptRequest = new Request("https://proofttl.test/verify", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "payment-signature": "test-payment-payload"
    },
    body: "{}"
  });
  assert(
    getVerifyRateLimitKey(paidAttemptRequest) === "verify:payment-attempt",
    "payment-bearing requests use a separate limiter bucket"
  );

  const wrongType = await validateVerifyRequest(
    new Request("https://proofttl.test/verify", {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body: "{}"
    })
  );
  assert(wrongType.ok === false && wrongType.status === 415, "non-JSON verify bodies are rejected with HTTP 415");

  const small = await validateVerifyRequest(challengeRequest, 1024);
  assert(small.ok === true, "small JSON verify bodies pass the body-size guard");

  const oversized = await validateVerifyRequest(
    new Request("https://proofttl.test/verify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ padding: "x".repeat(2048) })
    }),
    512
  );
  assert(oversized.ok === false && oversized.status === 413, "oversized verify bodies are rejected with HTTP 413");
  assert(oversized.max_bytes === 512, "oversized response reports the enforced byte ceiling");

  assert(DEFAULT_MAX_VERIFY_REQUEST_BYTES === 16 * 1024, "default verify body ceiling is 16 KiB");

  let pulls = 0;
  let cancelled = false;
  const encoder = new TextEncoder();
  const endless = new ReadableStream({
    pull(controller) {
      pulls += 1;
      controller.enqueue(encoder.encode("0123456789".repeat(128)));
    },
    cancel() {
      cancelled = true;
    }
  });

  const limited = await readResponseTextLimited(
    new Response(endless, { headers: { "content-type": "text/plain" } }),
    3000
  );
  assert(limited.length === 3000, "source reader returns exactly the configured character prefix");
  assert(cancelled === true, "source reader cancels the upstream stream after reaching its limit");
  assert(pulls < 20, "source reader stops pulling instead of consuming an unbounded response");

  const normalText = "A short source response that ends normally.";
  const normal = await readResponseTextLimited(
    new Response(normalText, { headers: { "content-type": "text/plain" } }),
    1000
  );
  assert(normal === normalText, "source reader preserves normal responses below the limit");

  console.log(`\nSUCCESS: ${passed} ProofTTL request/source limit checks passed.`);
}

run().catch((error) => {
  console.error("\nLIMIT REGRESSION TEST FAILED:", error.stack || error.message);
  process.exitCode = 1;
});
