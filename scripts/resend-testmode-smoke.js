/**
 * Explicit, safe Resend provider smoke test.
 * It can address only Resend's reserved delivered@resend.dev sink and uses
 * onboarding@resend.dev as sender. It cannot send to customer addresses.
 */
export function validateResendTestConfig(env) {
  if (env?.RESEND_TESTMODE_ONLY !== "true") {
    return { ok: false, code: "resend_test_mode_not_enabled" };
  }
  const apiKey = typeof env?.RESEND_API_KEY === "string" ? env.RESEND_API_KEY.trim() : "";
  if (!apiKey) return { ok: false, code: "resend_api_key_missing" };
  if (!apiKey.startsWith("re_")) return { ok: false, code: "resend_api_key_format_invalid" };
  return { ok: true, apiKey };
}

export async function sendResendTestEmail(env, fetchImpl = fetch) {
  const config = validateResendTestConfig(env);
  if (!config.ok) return config;

  const payload = {
    from: "ProofTTL test <onboarding@resend.dev>",
    to: ["delivered@resend.dev"],
    subject: "ProofTTL no-spend email provider check",
    html: "<p>ProofTTL email-provider test. This message uses the provider's reserved test recipient and contains no customer data.</p>"
  };

  let response;
  try {
    response = await fetchImpl("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        authorization: `Bearer ${config.apiKey}`,
        "content-type": "application/json"
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10000)
    });
  } catch {
    return { ok: false, code: "resend_api_unreachable" };
  }

  const body = await response.json().catch(() => null);
  if (!response.ok || typeof body?.id !== "string" || !body.id) {
    return { ok: false, code: "resend_api_rejected", http_status: response.status };
  }
  return {
    ok: true,
    email_id: body.id,
    from: payload.from,
    to: payload.to[0],
    test_sink_only: true
  };
}

async function main() {
  const result = await sendResendTestEmail(process.env);
  if (!result.ok) {
    console.error(`Resend test-mode smoke failed: ${result.code}${result.http_status ? ` (HTTP ${result.http_status})` : ""}`);
    process.exitCode = 1;
    return;
  }
  console.log(JSON.stringify({ ...result, sent_to_real_person: false, customer_address_used: false }));
}

import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
const entryUrl = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : "";
if (import.meta.url === entryUrl) await main();
