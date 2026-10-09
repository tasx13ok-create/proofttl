/**
 * Read-only guard for optional live Stripe TEST-mode credential verification.
 * This script refuses live keys before making any request. The only network
 * request it can perform is GET /v1/account, which cannot create a payment.
 */
export function validateStripeTestSecret(secret) {
  if (typeof secret !== "string" || !secret.trim()) {
    return { ok: false, code: "stripe_test_key_missing" };
  }
  const key = secret.trim();
  if (key.startsWith("sk_live_")) {
    return { ok: false, code: "live_key_refused" };
  }
  if (!key.startsWith("sk_test_")) {
    return { ok: false, code: "test_key_format_invalid" };
  }
  return { ok: true };
}

export async function probeStripeTestAccount(secret, fetchImpl = fetch) {
  const validation = validateStripeTestSecret(secret);
  if (!validation.ok) return validation;

  let response;
  try {
    response = await fetchImpl("https://api.stripe.com/v1/account", {
      method: "GET",
      headers: { authorization: `Bearer ${secret.trim()}` },
      signal: AbortSignal.timeout(10000)
    });
  } catch {
    return { ok: false, code: "stripe_api_unreachable" };
  }

  const body = await response.json().catch(() => null);
  if (!response.ok) {
    return { ok: false, code: "stripe_api_rejected", http_status: response.status };
  }
  if (body?.livemode !== false) {
    return { ok: false, code: "stripe_account_not_test_mode" };
  }
  return { ok: true, account_id: body.id ?? null, livemode: false };
}

async function main() {
  if (!process.argv.includes("--probe")) {
    console.error("Refusing to run without --probe. The probe is a read-only GET /v1/account and only accepts an sk_test_ key.");
    process.exitCode = 2;
    return;
  }

  const result = await probeStripeTestAccount(process.env.STRIPE_SECRET_KEY);
  if (!result.ok) {
    console.error(`Stripe test-mode preflight failed: ${result.code}${result.http_status ? ` (HTTP ${result.http_status})` : ""}`);
    process.exitCode = 1;
    return;
  }
  console.log(JSON.stringify({ ok: true, account_id: result.account_id, livemode: false, operation: "GET /v1/account", payment_created: false }));
}

const entryUrl = process.argv[1] ? new URL(`file://${process.argv[1].replaceAll("\\\\", "/")}`).href : "";
if (import.meta.url === entryUrl) await main();
