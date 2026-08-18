const BASE_URL = "https://proofttl.tasx13ok.workers.dev";
const EXPECTED_PROTOCOL = "ProofTTL/0.3.1";
const EXPECTED_NETWORK = "eip155:84532";
const EXPECTED_AMOUNT = "1000";
const EXPECTED_RECEIVER = "0x29949a066902bd329F74479c9AEBC448100955d8";

let passed = 0;

function assert(condition, message) {
  if (!condition) throw new Error(message);
  passed += 1;
  console.log(`PASS ${passed}: ${message}`);
}

async function json(url, init) {
  const response = await fetch(url, init);
  let body = null;
  try {
    body = await response.json();
  } catch {
    // Some x402 error bodies may be intentionally empty.
  }
  return { response, body };
}

function decodePaymentRequired(value) {
  return JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
}

async function run() {
  console.log(`ProofTTL smoke test: ${BASE_URL}`);
  console.log("No payment will be authorized by this script.\n");

  const health = await json(`${BASE_URL}/health`);
  assert(health.response.status === 200, "health returns HTTP 200");
  assert(health.body?.ok === true, "health reports ok=true");
  assert(health.body?.protocol === EXPECTED_PROTOCOL, `health reports ${EXPECTED_PROTOCOL}`);
  assert(health.body?.storage === true, "KV storage binding is active");
  assert(health.body?.ai === true, "Workers AI binding is active");
  assert(health.body?.automatic_monitoring === true, "automatic monitoring is active");

  const discovery = await json(`${BASE_URL}/.well-known/proofttl.json`);
  assert(discovery.response.status === 200, "discovery returns HTTP 200");
  assert(discovery.body?.protocol === EXPECTED_PROTOCOL, "discovery protocol matches");
  assert(discovery.body?.payments?.network === EXPECTED_NETWORK, "discovery advertises Base Sepolia");
  assert(discovery.body?.payments?.pay_to?.toLowerCase() === EXPECTED_RECEIVER.toLowerCase(), "discovery advertises the expected receiver");
  assert(discovery.body?.endpoints?.reverify?.public_enabled === false, "discovery marks manual reverify disabled");
  assert(Boolean(discovery.body?.lease_status_semantics?.issued_status), "discovery documents issued_status semantics");
  assert(Boolean(discovery.body?.lease_status_semantics?.current_status), "discovery documents current_status semantics");

  const openapi = await json(`${BASE_URL}/openapi.json`);
  assert(openapi.response.status === 200, "OpenAPI returns HTTP 200");
  const reverifyResponses = openapi.body?.paths?.["/lease/{lease_id}/reverify"]?.post?.responses;
  assert(Boolean(reverifyResponses?.["403"]), "OpenAPI documents manual reverify as HTTP 403");
  const leaseDescription = openapi.body?.paths?.["/lease/{lease_id}"]?.get?.description || "";
  assert(leaseDescription.includes("issued_status") && leaseDescription.includes("current_status"), "OpenAPI documents issued_status and current_status");

  const unpaid = await json(`${BASE_URL}/verify`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      claim: "Example Domain",
      source_url: "https://example.com",
      ttl_seconds: 300
    })
  });
  assert(unpaid.response.status === 402, "unpaid verify returns HTTP 402");

  const paymentHeader = unpaid.response.headers.get("payment-required");
  assert(Boolean(paymentHeader), "402 includes PAYMENT-REQUIRED header");
  const requirement = decodePaymentRequired(paymentHeader);
  assert(requirement?.x402Version === 2, "payment requirement uses x402 v2");
  const accepted = requirement?.accepts?.find(
    (item) => item?.scheme === "exact" && item?.network === EXPECTED_NETWORK
  );
  assert(Boolean(accepted), "payment requirement offers exact scheme on Base Sepolia");
  assert(String(accepted?.amount) === EXPECTED_AMOUNT, "payment requirement price is 1000 atomic USDC ($0.001)");
  assert(accepted?.payTo?.toLowerCase() === EXPECTED_RECEIVER.toLowerCase(), "payment requirement pays the expected receiver");

  const manual = await json(`${BASE_URL}/lease/smoke-test/reverify`, { method: "POST" });
  assert(manual.response.status === 403, "manual reverify returns HTTP 403");
  assert(manual.body?.error === "manual_reverify_disabled", "manual reverify returns the expected error code");

  console.log(`\nSUCCESS: ${passed} ProofTTL smoke checks passed. No payment was made.`);
}

run().catch((error) => {
  console.error("\nSMOKE TEST FAILED:", error.message);
  process.exitCode = 1;
});
