// Zero-cost guardrail: never authenticate to Stripe with a live key in these test commands.
const failures = [];
const stripeCandidates = [
  ["STRIPE_TEST_SECRET_KEY", process.env.STRIPE_TEST_SECRET_KEY],
  ["STRIPE_SECRET_KEY", process.env.STRIPE_SECRET_KEY]
].filter(([, value]) => Boolean(value));

for (const [name, value] of stripeCandidates) {
  if (!value.startsWith("sk_test_")) {
    failures.push(`${name} is set but is not a Stripe test-mode key; refusing to continue.`);
  }
}

if (failures.length) {
  for (const message of failures) console.error(`FAIL: ${message}`);
  process.exit(1);
}

console.log("PASS: no live Stripe key is configured for the zero-spend test path.");
if (stripeCandidates.length === 0) {
  console.log("INFO: no Stripe key supplied; checkout and webhook coverage will use deterministic fixtures.");
} else {
  console.log("INFO: Stripe key prefix is test-mode; no payment or checkout object is created by this preflight.");
}
if (process.env.RESEND_TEST_API_KEY) {
  console.log("INFO: a Resend test-sink key is available; no email is sent by this preflight.");
} else {
  console.log("INFO: Resend test-sink credentials are not configured; the optional provider smoke will be skipped.");
}
