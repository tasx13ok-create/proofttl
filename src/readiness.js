import { authRuntimeStatus } from "./auth.js";
import { assistantModelRuntime, assistantResponseProviderAvailable } from "./assistant-model-router.js";
import { runnerConfigured } from "./studio-runner.js";

export async function getDeploymentReadiness(env, request) {
  const auth = authRuntimeStatus(env, request);
  const trustedBrowserOrigin = auth.trustedOrigins.some((origin) => {
    try { const parsed = new URL(origin); return parsed.protocol === "https:" && parsed.origin !== new URL(request.url).origin; }
    catch { return false; }
  });
  const explicitCrossOriginCookies = String(env?.PROOFTTL_AUTH_CROSS_ORIGIN || "").toLowerCase() === "true";
  const authPublicUrl = clean(env?.PROOFTTL_AUTH_PUBLIC_URL || env?.BETTER_AUTH_URL);
  const configuredWebUrl = clean(env?.PROOFTTL_WEB_URL);
  const sameOriginProxySessions = Boolean(
    authPublicUrl &&
    configuredWebUrl &&
    authPublicUrl === configuredWebUrl &&
    isHttps(authPublicUrl) &&
    !explicitCrossOriginCookies
  );
  // Browser-session readiness can be satisfied either by true cross-origin cookies
  // or by the production same-origin Vercel proxy, which intentionally keeps
  // PROOFTTL_AUTH_CROSS_ORIGIN=false and forwards the browser session server-side.
  const crossOriginCookies = explicitCrossOriginCookies || sameOriginProxySessions;

  const schema = {
    monitor: await tableExists(env?.MONITOR_DB, "monitor_schedule"), auth: await tableExists(env?.MONITOR_DB, "session"), assistant_usage: await tableExists(env?.MONITOR_DB, "assistant_usage_daily"), account_entitlement: await tableExists(env?.MONITOR_DB, "account_entitlement"), audit_intake: await tableExists(env?.MONITOR_DB, "audit_intakes"), stripe_events: await tableExists(env?.MONITOR_DB, "stripe_webhook_events"), account_preferences: await tableExists(env?.MONITOR_DB, "account_preferences"), studio_projects: await tableExists(env?.MONITOR_DB, "studio_projects"), account_audit_links: await tableExists(env?.MONITOR_DB, "account_audit_links"), action_receipts: await tableExists(env?.MONITOR_DB, "action_receipts"), account_automations: await tableExists(env?.MONITOR_DB, "account_automations"), account_files: await tableExists(env?.MONITOR_DB, "account_files"), account_tasks: await tableExists(env?.MONITOR_DB, "account_tasks")
  };

  const modelRuntime = assistantModelRuntime(env);
  const webUrl = clean(env?.PROOFTTL_WEB_URL);
  const stripeSecret = clean(env?.STRIPE_SECRET_KEY);
  const commercialChecks = {
    audit_intake_schema: schema.audit_intake,
    stripe_event_schema: schema.stripe_events,
    stripe_secret: Boolean(stripeSecret),
    stripe_live_mode: stripeSecret.startsWith("sk_live_"),
    stripe_webhook_secret: Boolean(clean(env?.STRIPE_WEBHOOK_SECRET)),
    commercial_web_url: isHttps(webUrl),
    audit_admin_token: Boolean(clean(env?.PROOFTTL_ADMIN_TOKEN))
  };

  const checks = { kv_storage:Boolean(env?.LEASES), workers_ai:Boolean(env?.AI), verify_rate_limit:Boolean(env?.VERIFY_RATE_LIMITER), payer_rate_limit:Boolean(env?.PAYER_VERIFY_RATE_LIMITER), assistant_rate_limit:Boolean(env?.ASSISTANT_RATE_LIMITER), monitor_database:Boolean(env?.MONITOR_DB), monitor_schema:schema.monitor, auth_schema:schema.auth, assistant_usage_schema:schema.assistant_usage, account_entitlement_schema:schema.account_entitlement, payment_facilitator_credentials:Boolean(env?.CDP_API_KEY_ID&&env?.CDP_API_KEY_SECRET), issuance_signing:Boolean(env?.PROOFTTL_SIGNING_PRIVATE_JWK), auth_runtime:auth.configured, trusted_browser_origin:trustedBrowserOrigin, cross_origin_session_cookies:crossOriginCookies };
  const required=Object.values(checks), passing=required.filter(Boolean).length, testnetScore=Math.round((passing/required.length)*100);
  const trustedCustomerAuth=Boolean(auth.socialProviders.google&&auth.socialProviders.discord&&auth.passkeys);

  const accountChecks = { auth_schema:schema.auth, account_preferences_schema:schema.account_preferences, studio_projects_schema:schema.studio_projects, account_audit_links_schema:schema.account_audit_links, action_receipts_schema:schema.action_receipts, account_automations_schema:schema.account_automations, account_files_schema:schema.account_files, account_tasks_schema:schema.account_tasks, google_sign_in:auth.socialProviders.google, discord_sign_in:auth.socialProviders.discord, passkeys:auth.passkeys, trusted_browser_origin:trustedBrowserOrigin, cross_origin_session_cookies:crossOriginCookies };
  const aiChecks = { response_provider_available:assistantResponseProviderAvailable(env), response_provider:modelRuntime.provider, response_model_configured:Boolean(modelRuntime.response_model), voice_transcription_binding:Boolean(env?.AI), assistant_rate_limit:Boolean(env?.ASSISTANT_RATE_LIMITER) };
  const studioChecks = { account_storage:Boolean(env?.MONITOR_DB&&schema.studio_projects), coding_model:assistantResponseProviderAvailable(env), isolated_runner:runnerConfigured(env) };
  const workspaceChecks = { account_preferences:schema.account_preferences, action_receipts:schema.action_receipts, automations:schema.account_automations, native_files:schema.account_files, native_tasks:schema.account_tasks, studio_projects:schema.studio_projects, audit_ownership:schema.account_audit_links, credentialed_browser_sessions:Boolean(trustedBrowserOrigin&&crossOriginCookies), ai_response_provider:assistantResponseProviderAvailable(env) };

  const productionBlockers=[];
  if(!auth.socialProviders.google)productionBlockers.push("google_sign_in"); if(!auth.socialProviders.discord)productionBlockers.push("discord_sign_in"); if(!auth.passkeys)productionBlockers.push("passkey_sign_in"); if(!trustedBrowserOrigin)productionBlockers.push("trusted_browser_origin"); if(!crossOriginCookies)productionBlockers.push("cross_origin_session_cookies"); if(!schema.action_receipts)productionBlockers.push("action_receipts_schema"); if(!schema.account_automations)productionBlockers.push("account_automations_schema"); if(!schema.account_files)productionBlockers.push("account_files_schema"); if(!schema.account_tasks)productionBlockers.push("account_tasks_schema"); productionBlockers.push("mainnet_payment_validation","production_protocol_pricing_validation","paid_membership_billing","payer_account_linking");

  return {
    service:"ProofTTL", protocol:"ProofTTL/0.3.1", environment:"testnet",
    testnet:{score:testnetScore,ready:required.every(Boolean),passing_checks:passing,total_checks:required.length,checks},
    commercial_services:{ready:Object.values(commercialChecks).every(Boolean),payment_provider:"stripe",payment_mode:commercialChecks.stripe_live_mode?"live":"test_or_unconfigured",offers:["claim_stress_test_129","verification_audit_500","full_audit_upgrade_371"],scope_before_payment:true,checks:commercialChecks,note:"Human-facing audit services are commercially ready only when live Stripe credentials, webhook verification, D1 sales schema, the public web URL, and the admin control token are all configured."},
    customer_auth:{runtime_configured:auth.configured,trusted_customer_auth_ready:trustedCustomerAuth,account_product_ready:Object.values(accountChecks).every(Boolean),required_for_customer_launch:["google","discord","passkey"],trusted_browser_origin_configured:trustedBrowserOrigin,cross_origin_session_cookies:crossOriginCookies,session_transport:sameOriginProxySessions?"same_origin_proxy":"cross_origin_cookie",providers:auth.socialProviders,passkeys:auth.passkeys,checks:accountChecks,security:{secure_http_only_sessions:true,csrf_protection:true,origin_allowlist:true,totp:auth.totp,recovery_codes:auth.recoveryCodes}},
    ai:{ready:Boolean(aiChecks.response_provider_available&&aiChecks.response_model_configured&&aiChecks.assistant_rate_limit),provider:modelRuntime.provider,model:modelRuntime.response_model,preference_routing:"server_allowlisted",command_planning:"deterministic_before_model_fallback",checks:aiChecks},
    workspace:{ready:Object.values(workspaceChecks).every(Boolean),universal_command_planner:true,centralized_action_policy:true,account_action_receipts:schema.action_receipts,account_automation_definitions:schema.account_automations,native_account_files:schema.account_files,native_account_tasks:schema.account_tasks,automation_execution_connected:false,sensitive_unattended_automation:false,checks:workspaceChecks},
    studio:{cloud_projects_ready:studioChecks.account_storage,coding_ai_ready:studioChecks.coding_model,isolated_runner_ready:studioChecks.isolated_runner,runner_provider:"vercel-sandbox",runner_supported_languages:["javascript","python","bash"],checks:studioChecks},
    entitlements:{schema_ready:checks.account_entitlement_schema,browser_session_aware:checks.trusted_browser_origin&&checks.cross_origin_session_cookies,free_assistant_limit:Number(env?.PROOFTTL_ASSISTANT_FREE_DAILY_MESSAGES)||20,member_assistant_limit_default:Number(env?.PROOFTTL_MEMBER_ASSISTANT_DAILY_MESSAGES)||200,billing_enabled:false},
    protocol_mainnet:{ready:false,blockers:["mainnet_payment_validation","production_protocol_pricing_validation","payer_account_linking"],note:"Base mainnet remains deliberately disabled for protocol settlement. This does not prevent separate human-facing Stripe audit services from launching once their commercial checks pass."},
    production:{ready:false,blockers:productionBlockers},
    note:"Readiness is split by product surface so testnet protocol, commercial audit services, customer accounts, universal Workspace, AI, Files, Work, and Studio can be evaluated truthfully without implying unfinished providers or mainnet settlement are live."
  };
}

async function tableExists(db,tableName){if(!db||typeof db.prepare!=="function")return false;try{const row=await db.prepare("SELECT 1 AS ok FROM sqlite_master WHERE type = 'table' AND name = ?1 LIMIT 1").bind(tableName).first();return row?.ok===1||row?.ok===true;}catch{return false;}}
function clean(value){return typeof value==="string"?value.trim():"";}
function isHttps(value){try{return new URL(value).protocol==="https:";}catch{return false;}}
