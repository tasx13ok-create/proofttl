import assert from "node:assert/strict";
import { sendResendTestEmail, validateResendTestConfig } from "./resend-testmode-smoke.js";

let calls = 0;
const neverFetch = async () => { calls += 1; throw new Error("must not call provider"); };

assert.deepEqual(validateResendTestConfig({}), { ok: false, code: "resend_test_mode_not_enabled" });
assert.deepEqual(validateResendTestConfig({ RESEND_TESTMODE_ONLY: "true" }), { ok: false, code: "resend_api_key_missing" });
assert.deepEqual(validateResendTestConfig({ RESEND_TESTMODE_ONLY: "false", RESEND_API_KEY: "re_example" }), { ok: false, code: "resend_test_mode_not_enabled" });
assert.deepEqual(validateResendTestConfig({ RESEND_TESTMODE_ONLY: "true", RESEND_API_KEY: "invalid" }), { ok: false, code: "resend_api_key_format_invalid" });
assert.deepEqual(await sendResendTestEmail({ RESEND_API_KEY: "re_example" }, neverFetch), { ok: false, code: "resend_test_mode_not_enabled" });
assert.equal(calls, 0, "provider is not called unless explicit test mode is enabled");

const success = await sendResendTestEmail({ RESEND_TESTMODE_ONLY: "true", RESEND_API_KEY: "re_fixture_secret" }, async (url, options) => {
  calls += 1;
  assert.equal(url, "https://api.resend.com/emails");
  assert.equal(options.method, "POST");
  assert.equal(options.headers.authorization, "Bearer re_fixture_secret");
  const payload = JSON.parse(options.body);
  assert.equal(payload.from, "ProofTTL test <onboarding@resend.dev>");
  assert.deepEqual(payload.to, ["delivered@resend.dev"], "the provider sink is fixed; customer recipients cannot be injected");
  assert.equal(payload.subject, "ProofTTL no-spend email provider check");
  assert.equal(payload.html.includes("customer data"), true);
  return Response.json({ id: "email_test_fixture" });
});
assert.deepEqual(success, {
  ok: true,
  email_id: "email_test_fixture",
  from: "ProofTTL test <onboarding@resend.dev>",
  to: "delivered@resend.dev",
  test_sink_only: true
});
assert.equal(calls, 1, "valid opt-in test makes one provider request");

const rejected = await sendResendTestEmail({ RESEND_TESTMODE_ONLY: "true", RESEND_API_KEY: "re_fixture_secret" }, async () => new Response("{}", { status: 401 }));
assert.deepEqual(rejected, { ok: false, code: "resend_api_rejected", http_status: 401 });

console.log("SUCCESS: Resend smoke requires explicit test mode, never addresses a customer, and handles provider errors safely.");
