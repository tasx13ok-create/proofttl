import {
  DEFAULT_MAX_VERIFY_REQUEST_BYTES,
  enforceVerifiedPayerRateLimit,
  getVerifiedPayerRateLimitKey,
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

  const verifiedPayer = "0x58581d21D4b2c0D9D58E463d54C48863b7fdda43";
  const verifiedPayment = {
    paymentPayload: {
      payload: {
        authorization: { from: verifiedPayer }
      }
    }
  };
  const expectedPayerKey = `verify:payer:${verifiedPayer.toLowerCase()}`;
  assert(
    getVerifiedPayerRateLimitKey(verifiedPayment) === expectedPayerKey,
    "verified EVM payer produces a normalized payer limiter key"
  );
  assert(
    getVerifiedPayerRateLimitKey({ paymentPayload: { payload: { authorization: { from: "not-an-address" } } } }) === null,
    "invalid verified payer identity is rejected instead of creating a limiter key"
  );

  const invalidPayerGuard = await enforceVerifiedPayerRateLimit(
    { limit: async () => ({ success: true }) },
    { paymentPayload: { payload: { authorization: { from: "not-an-address" } } } }
  );
  assert(
    invalidPayerGuard.ok === false && invalidPayerGuard.status === 502,
    "payer quota guard fails closed when verified payer identity is invalid"
  );

  const missingLimiterGuard = await enforceVerifiedPayerRateLimit(null, verifiedPayment);
  assert(
    missingLimiterGuard.ok === false && missingLimiterGuard.status === 503,
    "payer quota guard fails closed when the payer limiter binding is missing"
  );

  let limitedKey = null;
  const overQuotaGuard = await enforceVerifiedPayerRateLimit(
    {
      async limit({ key }) {
        limitedKey = key;
        return { success: false };
      }
    },
    verifiedPayment
  );
  assert(
    overQuotaGuard.ok === false &&
      overQuotaGuard.status === 429 &&
      overQuotaGuard.retry_after_seconds === 60 &&
      limitedKey === expectedPayerKey,
    "over-quota payer is rejected with retry metadata using the normalized wallet key"
  );

  let allowedKey = null;
  const allowedPayerGuard = await enforceVerifiedPayerRateLimit(
    {
      async limit({ key }) {
        allowedKey = key;
        return { success: true };
      }
    },
    verifiedPayment
  );
  assert(
    allowedPayerGuard.ok === true &&
      allowedPayerGuard.payer === verifiedPayer.toLowerCase() &&
      allowedKey === expectedPayerKey,
    "allowed payer passes the quota guard with normalized wallet identity"
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
