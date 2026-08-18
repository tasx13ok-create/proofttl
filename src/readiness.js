import { authRuntimeStatus } from "./auth.js";

export async function getDeploymentReadiness(env, request) {
  const auth = authRuntimeStatus(env, request);
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
    payment_facilitator_credentials: Boolean(env?.CDP_API_KEY_ID && env?.CDP_API_KEY_SECRET),
    issuance_signing: Boolean(env?.PROOFTTL_SIGNING_PRIVATE_JWK),
    auth_runtime: auth.configured
  };

  const required = Object.values(checks);
  const passing = required.filter(Boolean).length;
  const testnetScore = Math.round((passing / required.length) * 100);
  const providerConfigured = Object.values(auth.socialProviders).some(Boolean) || auth.passkeys;

  const productionBlockers = [];
  if (!providerConfigured) productionBlockers.push("customer_sign_in_provider");
  productionBlockers.push("mainnet_payment_validation");
  productionBlockers.push("production_pricing_validation");
  productionBlockers.push("paid_membership_billing");

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
      sign_in_provider_configured: providerConfigured,
      providers: auth.socialProviders,
      passkeys: auth.passkeys
    },
    production: {
      ready: false,
      blockers: productionBlockers
    },
    note: "The production section remains false by design until mainnet, pricing, billing, and a customer sign-in path are deliberately enabled."
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
