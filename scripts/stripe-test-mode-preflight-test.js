import assert from "node:assert/strict";
import { probeStripeTestAccount, validateStripeTestSecret } from "./stripe-test-mode-preflight.js";

let networkCalls = 0;
const neverFetch = async () => { networkCalls += 1; throw new Error("must not call network"); };

assert.deepEqual(validateStripeTestSecret(""), { ok: false, code: "stripe_test_key_missing" });
assert.deepEqual(validateStripeTestSecret("sk_live_sensitive"), { ok: false, code: "live_key_refused" });
assert.deepEqual(validateStripeTestSecret("not_a_stripe_key"), { ok: false, code: "test_key_format_invalid" });
assert.deepEqual(validateStripeTestSecret("sk_test_fixture"), { ok: true });

assert.deepEqual(await probeStripeTestAccount("sk_live_sensitive", neverFetch), { ok: false, code: "live_key_refused" });
assert.equal(networkCalls, 0, "live key is rejected before any network request");
assert.deepEqual(await probeStripeTestAccount(undefined, neverFetch), { ok: false, code: "stripe_test_key_missing" });
assert.equal(networkCalls, 0, "missing key does not access the network");

const responseOk = await probeStripeTestAccount("sk_test_fixture", async (url, options) => {
  networkCalls += 1;
  assert.equal(url, "https://api.stripe.com/v1/account");
  assert.equal(options.method, "GET");
  assert.equal(options.headers.authorization, "Bearer sk_test_fixture");
  return Response.json({ id: "acct_test_fixture", livemode: false });
});
assert.deepEqual(responseOk, { ok: true, account_id: "acct_test_fixture", livemode: false });
assert.equal(networkCalls, 1, "valid test key performs one read-only account probe");

const liveAccount = await probeStripeTestAccount("sk_test_fixture", async () => Response.json({ id: "acct_wrong_mode", livemode: true }));
assert.deepEqual(liveAccount, { ok: false, code: "stripe_account_not_test_mode" });

const rejected = await probeStripeTestAccount("sk_test_fixture", async () => new Response("{}", { status: 401 }));
assert.deepEqual(rejected, { ok: false, code: "stripe_api_rejected", http_status: 401 });

console.log("SUCCESS: Stripe test-mode preflight rejects live/missing credentials before network access and permits only read-only account verification.");
