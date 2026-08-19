import { authRuntimeStatus } from "./auth.js";

export async function getDeploymentReadiness(env, request) {
  const auth = authRuntimeStatus(env, request);
  const trustedBrowserOrigin = auth.trustedOrigins.some((origin) => {
    try {
      const parsed = new URL(origin);
      return parsed.protocol === "https:" && parsed.origin !== new URL(request.url).origin;
    } catch {
      return false;
    }
  });
  const crossOriginCookies = String(env?.PROOFTTL_AUTH_CROSS_ORIGIN || "").toLowerCase() === "true";

  const checks = {
    kv_storage: Boolean(env?.LEASES),
    workers_ai: Boolean(env?.AI),
    verify_rate_limit: Boolean(env?.VERIFY_RATE_LIMITER),
    payer_rate_limit: Boolean(env?.PAYER_VERIFY_RATE_LIMITER),
    assistant_rate_limit: Boolean(env?.ASSISTANT_RATE_LIMITER),
    monitor_database: Boolean(env?.MONITOR_DB),
    monitor_schema: await tableExists(env?.MONITOR_DB, "monitor_schedule"),
    auth_schema: await tableExists(env?.MONITOR_DB, "session"),
    assistant_usage_schema: await tableExists(env?.MONITOR_DB, "assistant_usage_daily"),
    account_entitlement_schema: await tableExists(env?.MONITOR_DB, "account_entitlement"),
    payment_facilitator_credentials: Boolean(env?.CDP_API_KEY_ID && env?.CDP_API_KEY_SECRET),
    issuance_signing: Boolean(env?.PROOFTTL_SIGNING_PRIVATE_JWK),
    auth_runtime: auth.configured,
    trusted_browser_origin: trustedBrowserOrigin,
    cross_origin_session_cookies: crossOriginCookies
  };

  const required = Object.values(checks);
  const passing = required.filter(Boolean).length;
  const testnetScore = Math.round((passing / required.length) * 100);
  const trustedCustomerAuth = Boolean(
    auth.socialProviders.google &&
    auth.socialProviders.discord &&
    auth.passkeys
  );

  const productionBlockers = [];
  if (!auth.socialProviders.google) productionBlockers.push("google_sign_in");
  if (!auth.socialProviders.discord) productionBlockers.push("discord_sign_in");
  if (!auth.passkeys) productionBlockers.push("passkey_sign_in");
  if (!trustedBrowserOrigin) productionBlockers.push("trusted_browser_origin");
  if (!crossOriginCookies) productionBlockers.push("cross_origin_session_cookies");
  productionBlockers.push("mainnet_payment_validation");
  productionBlockers.push("production_pricing_validation");
  productionBlockers.push("paid_membership_billing");
  productionBlockers.push("payer_account_linking");

  return {
    service: "ProofTTL",
    protocol: "ProofTTL/0.3.1",
    environment: "testnet",
    testnet: {
      score: testnetScore,
      ready: required.every(Boolean),
      passing_checks: passing,
      total_checks: required.length,
      checks
    },
    customer_auth: {
      runtime_configured: auth.configured,
      trusted_customer_auth_ready: trustedCustomerAuth,
      required_for_customer_launch: ["google", "discord", "passkey"],
      trusted_browser_origin_configured: trustedBrowserOrigin,
      cross_origin_session_cookies: crossOriginCookies,
      providers: auth.socialProviders,
      passkeys: auth.passkeys,
      security: {
        secure_http_only_sessions: true,
        csrf_protection: true,
        origin_allowlist: true,
        totp: auth.totp,
        recovery_codes: auth.recoveryCodes
      }
    },
    entitlements: {
      schema_ready: checks.account_entitlement_schema,
      browser_session_aware: checks.trusted_browser_origin && checks.cross_origin_session_cookies,
      free_assistant_limit: Number(env?.PROOFTTL_ASSISTANT_FREE_DAILY_MESSAGES) || 20,
      member_assistant_limit_default: Number(env?.PROOFTTL_MEMBER_ASSISTANT_DAILY_MESSAGES) || 200,
      billing_enabled: false
    },
    production: {
      ready: false,
      blockers: productionBlockers
    },
    note: "Testnet readiness requires durable storage, AI/rate limits, signing, payment credentials, schemas, and a safe credentialed browser-session path. Customer launch additionally requires Google, Discord, and passkey sign-in. Production remains false until mainnet, pricing, billing, payer ownership, and those trusted customer-auth paths are deliberately enabled."
  };
}

async function tableExists(db, tableName) {
  if (!db || typeof db.prepare !== "function") return false;
  try {
    const row = await db
      .prepare("SELECT 1 AS ok FROM sqlite_master WHERE type = 'table' AND name = ?1 LIMIT 1")
      .bind(tableName)
      .first();
    return row?.ok === 1 || row?.ok === true;
  } catch {
    return false;
  }
}
