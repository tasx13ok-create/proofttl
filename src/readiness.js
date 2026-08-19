import { authRuntimeStatus } from "./auth.js";
import { assistantModelRuntime, assistantResponseProviderAvailable } from "./assistant-model-router.js";
import { runnerConfigured } from "./studio-runner.js";

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

  const schema = {
    monitor: await tableExists(env?.MONITOR_DB, "monitor_schedule"),
    auth: await tableExists(env?.MONITOR_DB, "session"),
    assistant_usage: await tableExists(env?.MONITOR_DB, "assistant_usage_daily"),
    account_entitlement: await tableExists(env?.MONITOR_DB, "account_entitlement"),
    audit_intake: await tableExists(env?.MONITOR_DB, "audit_intakes"),
    stripe_events: await tableExists(env?.MONITOR_DB, "stripe_webhook_events"),
    account_preferences: await tableExists(env?.MONITOR_DB, "account_preferences"),
    studio_projects: await tableExists(env?.MONITOR_DB, "studio_projects"),
    account_audit_links: await tableExists(env?.MONITOR_DB, "account_audit_links")
  };

  const modelRuntime = assistantModelRuntime(env);
  const webUrl = clean(env?.PROOFTTL_WEB_URL);
  const commercialWebUrl = isHttps(webUrl);
  const stripeSecret = Boolean(clean(env?.STRIPE_SECRET_KEY));
  const stripeWebhookSecret = Boolean(clean(env?.STRIPE_WEBHOOK_SECRET));
  const auditAdminSecret = Boolean(clean(env?.PROOFTTL_AUDIT_ADMIN_SECRET));

  const checks = {
    kv_storage: Boolean(env?.LEASES),
    workers_ai: Boolean(env?.AI),
    verify_rate_limit: Boolean(env?.VERIFY_RATE_LIMITER),
    payer_rate_limit: Boolean(env?.PAYER_VERIFY_RATE_LIMITER),
    assistant_rate_limit: Boolean(env?.ASSISTANT_RATE_LIMITER),
    monitor_database: Boolean(env?.MONITOR_DB),
    monitor_schema: schema.monitor,
    auth_schema: schema.auth,
    assistant_usage_schema: schema.assistant_usage,
    account_entitlement_schema: schema.account_entitlement,
    payment_facilitator_credentials: Boolean(env?.CDP_API_KEY_ID && env?.CDP_API_KEY_SECRET),
    issuance_signing: Boolean(env?.PROOFTTL_SIGNING_PRIVATE_JWK),
    auth_runtime: auth.configured,
    trusted_browser_origin: trustedBrowserOrigin,
    cross_origin_session_cookies: crossOriginCookies
  };

  const required = Object.values(checks);
  const passing = required.filter(Boolean).length;
  const testnetScore = Math.round((passing / required.length) * 100);
  const trustedCustomerAuth = Boolean(auth.socialProviders.google && auth.socialProviders.discord && auth.passkeys);

  const commercialChecks = {
    audit_intake_schema: schema.audit_intake,
    stripe_event_schema: schema.stripe_events,
    stripe_secret: stripeSecret,
    stripe_webhook_secret: stripeWebhookSecret,
    commercial_web_url: commercialWebUrl,
    audit_admin_secret: auditAdminSecret
  };
  const commercialReady = Object.values(commercialChecks).every(Boolean);

  const accountChecks = {
    auth_schema: schema.auth,
    account_preferences_schema: schema.account_preferences,
    studio_projects_schema: schema.studio_projects,
    account_audit_links_schema: schema.account_audit_links,
    google_sign_in: auth.socialProviders.google,
    discord_sign_in: auth.socialProviders.discord,
    passkeys: auth.passkeys,
    trusted_browser_origin: trustedBrowserOrigin,
    cross_origin_session_cookies: crossOriginCookies
  };
  const accountReady = Object.values(accountChecks).every(Boolean);

  const aiChecks = {
    response_provider_available: assistantResponseProviderAvailable(env),
    response_provider: modelRuntime.provider,
    response_model_configured: Boolean(modelRuntime.response_model),
    voice_transcription_binding: Boolean(env?.AI),
    assistant_rate_limit: Boolean(env?.ASSISTANT_RATE_LIMITER)
  };

  const studioChecks = {
    account_storage: Boolean(env?.MONITOR_DB && schema.studio_projects),
    coding_model: assistantResponseProviderAvailable(env),
    isolated_runner: runnerConfigured(env)
  };

  const productionBlockers = [];
  if (!auth.socialProviders.google) productionBlockers.push("google_sign_in");
  if (!auth.socialProviders.discord) productionBlockers.push("discord_sign_in");
  if (!auth.passkeys) productionBlockers.push("passkey_sign_in");
  if (!trustedBrowserOrigin) productionBlockers.push("trusted_browser_origin");
  if (!crossOriginCookies) productionBlockers.push("cross_origin_session_cookies");
  productionBlockers.push("mainnet_payment_validation");
  productionBlockers.push("production_protocol_pricing_validation");
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
    commercial_services: {
      ready: commercialReady,
      payment_provider: "stripe",
      offers: ["claim_stress_test_129", "verification_audit_500", "full_audit_upgrade_371"],
      scope_before_payment: true,
      checks: commercialChecks,
      note: "Human-facing audit services can become commercially ready through Stripe independently of the x402 protocol remaining on Base Sepolia testnet."
    },
    customer_auth: {
      runtime_configured: auth.configured,
      trusted_customer_auth_ready: trustedCustomerAuth,
      account_product_ready: accountReady,
      required_for_customer_launch: ["google", "discord", "passkey"],
      trusted_browser_origin_configured: trustedBrowserOrigin,
      cross_origin_session_cookies: crossOriginCookies,
      providers: auth.socialProviders,
      passkeys: auth.passkeys,
      checks: accountChecks,
      security: {
        secure_http_only_sessions: true,
        csrf_protection: true,
        origin_allowlist: true,
        totp: auth.totp,
        recovery_codes: auth.recoveryCodes
      }
    },
    ai: {
      ready: Boolean(aiChecks.response_provider_available && aiChecks.response_model_configured && aiChecks.assistant_rate_limit),
      provider: modelRuntime.provider,
      model: modelRuntime.response_model,
      preference_routing: "server_allowlisted",
      checks: aiChecks
    },
    studio: {
      cloud_projects_ready: studioChecks.account_storage,
      coding_ai_ready: studioChecks.coding_model,
      isolated_runner_ready: studioChecks.isolated_runner,
      runner_provider: "vercel-sandbox",
      runner_supported_languages: ["javascript", "python", "bash"],
      checks: studioChecks
    },
    entitlements: {
      schema_ready: checks.account_entitlement_schema,
      browser_session_aware: checks.trusted_browser_origin && checks.cross_origin_session_cookies,
      free_assistant_limit: Number(env?.PROOFTTL_ASSISTANT_FREE_DAILY_MESSAGES) || 20,
      member_assistant_limit_default: Number(env?.PROOFTTL_MEMBER_ASSISTANT_DAILY_MESSAGES) || 200,
      billing_enabled: false
    },
    protocol_mainnet: {
      ready: false,
      blockers: ["mainnet_payment_validation", "production_protocol_pricing_validation", "payer_account_linking"],
      note: "Base mainnet remains deliberately disabled for protocol settlement. This does not prevent separate human-facing Stripe audit services from launching once their commercial checks pass."
    },
    production: {
      ready: false,
      blockers: productionBlockers
    },
    note: "Readiness is split by product surface so testnet protocol, commercial audit services, customer accounts, AI, and Studio can be evaluated truthfully without implying unfinished mainnet settlement is live."
  };
}

async function tableExists(db, tableName) {
  if (!db || typeof db.prepare !== "function") return false;
  try {
    const row = await db.prepare("SELECT 1 AS ok FROM sqlite_master WHERE type = 'table' AND name = ?1 LIMIT 1").bind(tableName).first();
    return row?.ok === 1 || row?.ok === true;
  } catch {
    return false;
  }
}

function clean(value) { return typeof value === "string" ? value.trim() : ""; }
function isHttps(value) { try { return new URL(value).protocol === "https:"; } catch { return false; } }
