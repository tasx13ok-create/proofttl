// Read-only Stripe credential smoke. This script never creates customers, sessions, intents, or charges.
const key = process.env.STRIPE_TEST_SECRET_KEY;
if (!key) {
  if (process.env.REQUIRE_STRIPE_TEST_MODE === "1") {
    console.error("FAIL: STRIPE_TEST_SECRET_KEY is required for this manually requested provider check.");
    process.exit(1);
  }
  console.log("SKIP: STRIPE_TEST_SECRET_KEY is not configured; no Stripe API request was made.");
  process.exit(0);
}
if (!key.startsWith("sk_test_")) {
  console.error("FAIL: refusing to send any key not prefixed sk_test_. No request was made.");
  process.exit(1);
}

const controller = new AbortController();
const timeout = setTimeout(() => controller.abort(), 10000);
try {
  const response = await fetch("https://api.stripe.com/v1/account", {
    method: "GET",
    headers: { authorization: `Bearer ${key}` },
    signal: controller.signal
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || body?.object !== "account" || typeof body?.id !== "string") {
    console.error(`FAIL: Stripe test-mode credential check returned HTTP ${response.status}.`);
    process.exit(1);
  }
  console.log("PASS: Stripe accepted the test-mode key for a read-only account lookup. No payment objects or charges were created.");
} catch (error) {
  console.error(`FAIL: Stripe read-only test-mode check could not complete (${error?.name || "request_error"}).`);
  process.exit(1);
} finally {
  clearTimeout(timeout);
}
