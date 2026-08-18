const BASE_URL = (
  process.env.PROOFTTL_BASE_URL ||
  "https://proofttl.tasx13ok.workers.dev"
).replace(/\/+$/, "");
const EXPECTED_PROTOCOL = "ProofTTL/0.3.1";
const EXPECTED_NETWORK = "eip155:84532";
const EXPECTED_AMOUNT = "1000";
const EXPECTED_RECEIVER = "0x29949a066902bd329F74479c9AEBC448100955d8";
const EXPECTED_FRONTEND_ORIGIN =
  process.env.PROOFTTL_FRONTEND_ORIGIN ||
  "https://proofttl-web-git-main-tasx13ok-1769s-projects.vercel.app";

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

function headerIncludes(response, name, expected) {
  return (response.headers.get(name) || "")
    .toLowerCase()
    .includes(expected.toLowerCase());
}

function assertHttpStatus(result, expectedStatus, message) {
  if (result.response.status !== expectedStatus) {
    const errorCode =
      result.body && typeof result.body?.error === "string"
        ? `; error=${result.body.error}`
        : "";
    const detail =
      result.body && typeof result.body?.message === "string"
        ? `; message=${result.body.message}`
        : "";
    throw new Error(
      `${message} (got HTTP ${result.response.status}${errorCode}${detail})`
    );
  }
  assert(true, message);
}

async function run() {
  console.log(`ProofTTL smoke test: ${BASE_URL}`);
  console.log("No payment will be authorized and no AI inference will be invoked by this script.\n");

  const health = await json(`${BASE_URL}/health`);
  assert(health.response.status === 200, "health returns HTTP 200");
  assert(health.body?.ok === true, "health reports ok=true");
  assert(health.body?.protocol === EXPECTED_PROTOCOL, `health reports ${EXPECTED_PROTOCOL}`);
  assert(health.body?.storage === true, "KV storage binding is active");
  assert(health.body?.ai === true, "Workers AI binding is active");
  assert(health.body?.automatic_monitoring === true, "automatic monitoring is active");

  const readiness = await json(`${BASE_URL}/readiness`);
  assert(readiness.response.status === 200, "readiness returns HTTP 200");
  assert(readiness.body?.environment === "testnet", "readiness identifies testnet environment");
  assert(readiness.body?.testnet?.ready === true, "all required testnet readiness checks pass");
  assert(readiness.body?.testnet?.score === 100, "testnet readiness score is 100");
  assert(readiness.body?.testnet?.checks?.assistant_usage_schema === true, "assistant usage schema is installed");
  assert(readiness.body?.testnet?.checks?.account_entitlement_schema === true, "account entitlement schema is installed");
  assert(readiness.body?.testnet?.checks?.trusted_browser_origin === true, "trusted browser origin is configured");
  assert(readiness.body?.testnet?.checks?.cross_origin_session_cookies === true, "cross-origin session cookies are configured");
  assert(readiness.body?.entitlements?.browser_session_aware === true, "entitlements are browser-session aware");
  assert(readiness.body?.entitlements?.billing_enabled === false, "billing remains intentionally disabled");
  assert(readiness.body?.production?.ready === false, "production remains intentionally disabled");

  const discovery = await json(`${BASE_URL}/.well-known/proofttl.json`);
  assert(discovery.response.status === 200, "discovery returns HTTP 200");
  assert(discovery.body?.protocol === EXPECTED_PROTOCOL, "discovery protocol matches");
  assert(discovery.body?.payments?.network === EXPECTED_NETWORK, "discovery advertises Base Sepolia");
  assert(discovery.body?.payments?.pay_to?.toLowerCase() === EXPECTED_RECEIVER.toLowerCase(), "discovery advertises the expected receiver");
  assert(discovery.body?.endpoints?.reverify?.public_enabled === false, "discovery marks manual reverify disabled");
  assert(Boolean(discovery.body?.lease_status_semantics?.issued_status), "discovery documents issued_status semantics");
  assert(Boolean(discovery.body?.lease_status_semantics?.current_status), "discovery documents current_status semantics");
  assert(discovery.body?.endpoints?.assistant_voice?.path === "/assistant/voice", "discovery advertises the voice assistant endpoint");
  assert(discovery.body?.endpoints?.assistant_text?.path === "/assistant/text", "discovery advertises the text assistant endpoint");
  assert(discovery.body?.endpoints?.account_entitlement?.path === "/account/entitlement", "discovery advertises account entitlement status");
  assert(discovery.body?.assistant?.contextual_history?.max_messages === 6, "discovery documents bounded six-message assistant context");

  const assistant = await json(`${BASE_URL}/.well-known/proofttl-assistant.json`);
  assert(assistant.response.status === 200, "assistant discovery returns HTTP 200");
  assert(
    assistant.body?.interaction === "text_or_voice_input_text_and_optional_voice_output",
    "assistant discovery reports text/voice input with text and optional voice output"
  );
  assert(assistant.body?.output?.text === true, "assistant discovery confirms text output");
  assert(assistant.body?.output?.voice === true, "assistant discovery confirms optional voice output");
  assert(assistant.body?.endpoints?.voice === "/assistant/voice", "assistant discovery reports voice endpoint");
  assert(assistant.body?.endpoints?.text === "/assistant/text", "assistant discovery reports text endpoint");
  assert(assistant.body?.endpoints?.usage === "/assistant/usage", "assistant discovery reports usage endpoint");
  assert(assistant.body?.scope === "proofttl_product_only", "assistant discovery reports product-only scope");
  assert(assistant.body?.quota?.shared_between_text_and_voice === true, "assistant quota is shared between text and voice");
  assert(assistant.body?.quota?.account_entitlements === true, "assistant discovery reports account entitlement support");
  assert(assistant.body?.quota?.authenticated_browser_sessions_supported === true, "assistant discovery reports authenticated browser session support");
  assert(Number(assistant.body?.quota?.free_daily_messages) > 0, "assistant discovery advertises a positive free daily quota");
  assert(assistant.body?.configured === true, "assistant discovery reports AI and rate limiting configured");
  assert(assistant.body?.audio_retention === "none_by_default", "assistant discovery reports no default audio retention");
  assert(assistant.body?.free_capacity_behavior === "fail_closed_no_paid_fallback", "assistant discovery forbids paid fallback");

  const usage = await json(`${BASE_URL}/assistant/usage`);
  assert(usage.response.status === 200, "assistant usage returns HTTP 200");
  assert(usage.body?.quota?.plan === "free", "anonymous assistant usage reports free plan");
  assert(usage.body?.quota?.authenticated === false, "anonymous assistant usage is not treated as authenticated");
  assert(Number(usage.body?.quota?.limit) > 0, "assistant usage reports a positive limit");
  assert(typeof usage.body?.quota?.remaining === "number", "assistant usage reports authoritative remaining quota");
  assert(usage.body?.quota?.accounting_backend === "d1", "assistant usage uses D1 durable accounting");

  const unsignedEntitlement = await json(`${BASE_URL}/account/entitlement`, { method: "GET" });
  assert(unsignedEntitlement.response.status === 401, "unsigned account entitlement read returns HTTP 401");
  assert(unsignedEntitlement.body?.error === "authentication_required", "unsigned entitlement read returns the expected error");

  const openapi = await json(`${BASE_URL}/openapi.json`);
  assert(openapi.response.status === 200, "OpenAPI returns HTTP 200");
  const reverifyResponses = openapi.body?.paths?.["/lease/{lease_id}/reverify"]?.post?.responses;
  assert(Boolean(reverifyResponses?.["403"]), "OpenAPI documents manual reverify as HTTP 403");
  const leaseDescription = openapi.body?.paths?.["/lease/{lease_id}"]?.get?.description || "";
  assert(leaseDescription.includes("issued_status") && leaseDescription.includes("current_status"), "OpenAPI documents issued_status and current_status");
  assert(Boolean(openapi.body?.paths?.["/assistant/voice"]?.post), "OpenAPI documents POST /assistant/voice");
  assert(Boolean(openapi.body?.paths?.["/assistant/text"]?.post), "OpenAPI documents POST /assistant/text");
  assert(Boolean(openapi.body?.paths?.["/account/entitlement"]?.get), "OpenAPI documents GET /account/entitlement");
  const historySchema = openapi.body?.paths?.["/assistant/text"]?.post?.requestBody?.content?.["application/json"]?.schema?.properties?.history;
  assert(historySchema?.maxItems === 6, "OpenAPI caps assistant history at six messages");

  const verifyPreflight = await fetch(`${BASE_URL}/verify`, {
    method: "OPTIONS",
    headers: {
      origin: "https://browser.example",
      "access-control-request-method": "POST",
      "access-control-request-headers": "content-type,payment-signature"
    }
  });
  assert(verifyPreflight.status === 204, "verify browser preflight returns HTTP 204");
  assert(headerIncludes(verifyPreflight, "access-control-allow-headers", "payment-signature"), "verify preflight allows PAYMENT-SIGNATURE");
  assert(headerIncludes(verifyPreflight, "access-control-allow-headers", "content-type"), "verify preflight allows Content-Type");

  const anonymousAssistantPreflight = await fetch(`${BASE_URL}/assistant/voice`, {
    method: "OPTIONS",
    headers: {
      origin: "https://browser.example",
      "access-control-request-method": "POST",
      "access-control-request-headers": "content-type"
    }
  });
  assert(anonymousAssistantPreflight.status === 204, "anonymous assistant browser preflight returns HTTP 204");
  assert(anonymousAssistantPreflight.headers.get("access-control-allow-origin") === "*", "untrusted assistant origin remains anonymous wildcard access");
  assert(anonymousAssistantPreflight.headers.get("access-control-allow-credentials") === null, "untrusted assistant origin never receives credential permission");
  assert(headerIncludes(anonymousAssistantPreflight, "access-control-allow-headers", "content-type"), "assistant preflight allows Content-Type");

  const trustedAssistantPreflight = await fetch(`${BASE_URL}/assistant/text`, {
    method: "OPTIONS",
    headers: {
      origin: EXPECTED_FRONTEND_ORIGIN,
      "access-control-request-method": "POST",
      "access-control-request-headers": "content-type"
    }
  });
  assert(trustedAssistantPreflight.status === 204, "trusted frontend assistant preflight returns HTTP 204");
  assert(trustedAssistantPreflight.headers.get("access-control-allow-origin") === EXPECTED_FRONTEND_ORIGIN, "trusted frontend origin is reflected for assistant requests");
  assert(trustedAssistantPreflight.headers.get("access-control-allow-credentials") === "true", "trusted frontend can send assistant session cookies");

  const trustedUsage = await json(`${BASE_URL}/assistant/usage`, {
    headers: { origin: EXPECTED_FRONTEND_ORIGIN }
  });
  assert(trustedUsage.response.status === 200, "trusted frontend can read assistant usage");
  assert(trustedUsage.response.headers.get("access-control-allow-origin") === EXPECTED_FRONTEND_ORIGIN, "assistant usage reflects trusted frontend origin");
  assert(trustedUsage.response.headers.get("access-control-allow-credentials") === "true", "assistant usage permits trusted frontend credentials");

  const unpaid = await json(`${BASE_URL}/verify`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      claim: "Example Domain",
      source_url: "https://example.com",
      ttl_seconds: 300
    })
  });
  assertHttpStatus(unpaid, 402, "unpaid verify returns HTTP 402");
  assert(unpaid.response.headers.get("access-control-allow-origin") === "*", "402 is readable cross-origin");
  assert(headerIncludes(unpaid.response, "access-control-expose-headers", "payment-required"), "402 exposes PAYMENT-REQUIRED to browser clients");
  assert(headerIncludes(unpaid.response, "access-control-expose-headers", "payment-response"), "browser clients can read PAYMENT-RESPONSE after settlement");

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

  console.log(`\nSUCCESS: ${passed} ProofTTL smoke checks passed. No payment or AI inference was made.`);
}

run().catch((error) => {
  console.error("\nSMOKE TEST FAILED:", error.message);
  process.exitCode = 1;
});
