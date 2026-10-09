// Optional Resend smoke routed exclusively to Resend's documented delivery-simulation sink.
// Never change the recipient to a customer address or use this script for production sending.
const apiKey = process.env.RESEND_TEST_API_KEY;
if (!apiKey) {
  if (process.env.REQUIRE_RESEND_SINK === "1") {
    console.error("FAIL: RESEND_TEST_API_KEY is required for this manually requested sink test.");
    process.exit(1);
  }
  console.log("SKIP: RESEND_TEST_API_KEY is not configured; no email request was made.");
  process.exit(0);
}
if (process.env.PROOFTTL_EMAIL_MODE === "production") {
  console.error("FAIL: refusing to run the sink test with PROOFTTL_EMAIL_MODE=production.");
  process.exit(1);
}

const day = new Date().toISOString().slice(0, 10);
const idempotencyKey = `proofttl-zero-spend-resend-sink-${day}`;
const payload = {
  from: "onboarding@resend.dev",
  to: ["delivered@resend.dev"],
  subject: "[ProofTTL TEST] Zero-spend email delivery simulation",
  text: [
    "This is a synthetic ProofTTL email-provider smoke test.",
    "It contains no customer data, no order information, and no live checkout details.",
    "The recipient is Resend's documented delivery-simulation sink; this is not a customer email.",
    `Test date (UTC): ${day}`
  ].join("\n"),
  tags: [
    { name: "environment", value: "test" },
    { name: "purpose", value: "zero-spend-email-sink" }
  ]
};
const controller = new AbortController();
const timeout = setTimeout(() => controller.abort(), 10000);
try {
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
      "idempotency-key": idempotencyKey
    },
    body: JSON.stringify(payload),
    signal: controller.signal
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || typeof body?.id !== "string") {
    const providerMessage = typeof body?.message === "string" ? body.message.slice(0, 240) : "request rejected";
    console.error(`FAIL: Resend sink request returned HTTP ${response.status}: ${providerMessage}`);
    process.exit(1);
  }
  console.log(`PASS: Resend accepted a sink-only delivery simulation (message ID ${body.id}).`);
  console.log("NOTE: this validates Resend API acceptance for the test sink, not a production-domain customer email.");
} catch (error) {
  console.error(`FAIL: Resend sink check could not complete (${error?.name || "request_error"}).`);
  process.exit(1);
} finally {
  clearTimeout(timeout);
}
