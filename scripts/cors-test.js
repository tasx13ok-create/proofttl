import { PUBLIC_API_CORS, withPublicApiCors } from "../src/cors.js";

let passed = 0;
function assert(condition, message) {
  if (!condition) throw new Error(message);
  passed += 1;
  console.log(`PASS ${passed}: ${message}`);
}

async function run() {
  console.log("ProofTTL public API CORS tests\n");

  const source = new Response("payment required", {
    status: 402,
    headers: {
      "content-type": "application/json",
      "payment-required": "example-challenge"
    }
  });
  const response = withPublicApiCors(source);

  assert(response.status === 402, "CORS wrapper preserves HTTP 402 status");
  assert(
    response.headers.get("access-control-allow-origin") === "*",
    "all public API responses allow browser origins"
  );
  assert(
    response.headers.get("access-control-allow-methods") === "GET,POST,OPTIONS",
    "CORS advertises only required public methods"
  );
  assert(
    response.headers.get("access-control-allow-headers")
      ?.split(",")
      .map((value) => value.trim().toLowerCase())
      .includes("payment-signature"),
    "browser x402 retries may send PAYMENT-SIGNATURE"
  );
  assert(
    response.headers.get("access-control-expose-headers")
      ?.split(",")
      .map((value) => value.trim().toLowerCase())
      .includes("payment-required"),
    "browser clients may read PAYMENT-REQUIRED challenge"
  );
  assert(
    response.headers.get("access-control-expose-headers")
      ?.split(",")
      .map((value) => value.trim().toLowerCase())
      .includes("payment-response"),
    "browser clients may read PAYMENT-RESPONSE settlement metadata"
  );
  assert(
    response.headers.get("payment-required") === "example-challenge",
    "CORS wrapper preserves x402 protocol headers"
  );
  assert(
    PUBLIC_API_CORS.allowed_headers === "content-type,payment-signature",
    "CORS configuration remains explicit and narrow"
  );

  console.log(`\nSUCCESS: ${passed} public API CORS checks passed.`);
}

run().catch((error) => {
  console.error("\nCORS TEST FAILED:", error.stack || error.message);
  process.exitCode = 1;
});
