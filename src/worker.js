import entry from "./entry.js";
import { handleVoiceAssistant, loveCapability, ASSISTANT_LIMITS, ASSISTANT_MODELS } from "./assistant.js";
import { handleTextAssistant } from "./assistant-text.js";
import { handleAssistantSpeech } from "./assistant-speech.js";
import { handleAssistantVisuals, ASSISTANT_VISUALS } from "./assistant-visuals.js";
import { handleStudioChat } from "./studio-chat.js";
import { handleStudioRun, runnerConfigured } from "./studio-runner.js";
import { assistantModelCatalog } from "./assistant-model-router.js";
import { capabilityRegistry } from "./capability-registry.js";
import { planNaturalLanguageCommand } from "./command-planner.js";
import { handleActionPlan, handleAccountActions } from "./action-control.js";
import { handleAccountAutomations } from "./account-automations.js";
import { handleAccountFiles } from "./account-files.js";
import { handleAccountTasks } from "./account-tasks.js";
import { handleAccountWorkspace } from "./account-workspace.js";
import { handleAuditIntake } from "./audit-intake.js";
import { handleAuditStatus, handleAuditAdmin, auditAdminAuthorized } from "./audit-sales.js";
import { createAuditCheckoutSession, handleStripeWebhook } from "./stripe-payments.js";
import { assistantQuotaLimit, getAssistantQuota } from "./assistant-quota.js";
import { applyAssistantCors, assistantPreflightResponse } from "./assistant-cors.js";
import { AUTH_PATH_PREFIX, authRuntimeStatus, handleProofTTLAuth } from "./auth.js";
import { applyAuthCors, authPreflightResponse } from "./auth-cors.js";
import { applyApiCors, apiCorsPreflightResponse } from "./http-cors.js";
import { resolveAssistantEntitlement } from "./entitlements.js";
import { getDeploymentReadiness } from "./readiness.js";
import { renderLandingPage } from "./site.js";
import { handleCinematics } from "./cinematics.js";

const PRODUCT_VERSION = "1.0.0";
const COMPATIBLE_PROTOCOL = "ProofTTL/0.3.1";
const ASSISTANT_VOICE_PATH = "/assistant/voice";
const ASSISTANT_TEXT_PATH = "/assistant/text";
const ASSISTANT_SPEECH_PATH = "/assistant/speech";
const ASSISTANT_VISUALS_PATH = "/assistant/visuals";
const ASSISTANT_USAGE_PATH = "/assistant/usage";
const ASSISTANT_MODELS_PATH = "/assistant/models";
const CAPABILITIES_PATH = "/capabilities";
const COMMAND_PLAN_PATH = "/commands/plan";
const ACTION_PLAN_PATH = "/actions/plan";
const ACCOUNT_ACTIONS_PATH = "/account/actions";
const ACCOUNT_AUTOMATIONS_PATH = "/account/automations";
const ACCOUNT_FILES_PATH = "/account/files";
const ACCOUNT_TASKS_PATH = "/account/tasks";
const STUDIO_CHAT_PATH = "/studio/chat";
const STUDIO_RUN_PATH = "/studio/run";
const STUDIO_RUNNER_STATUS_PATH = "/studio/runner";
const ACCOUNT_ENTITLEMENT_PATH = "/account/entitlement";
const ACCOUNT_PREFERENCES_PATH = "/account/preferences";
const ACCOUNT_AUDITS_PATH = "/account/audits";
const STUDIO_PROJECTS_PATH = "/studio/projects";
const AUDIT_INTAKE_PATH = "/audit/intake";
const AUDIT_STATUS_PATH = "/audit/intake/status";
const AUDIT_ADMIN_PREFIX = "/admin/audit/intakes";
const STRIPE_WEBHOOK_PATH = "/payments/stripe/webhook";
const READINESS_PATH = "/readiness";
const AUTH_DISCOVERY_PATH = "/.well-known/proofttl-auth.json";
const CINEMATICS_PREFIX = "/cinematics";

function isAuthPath(pathname) { return pathname === AUTH_PATH_PREFIX || pathname.startsWith(`${AUTH_PATH_PREFIX}/`); }
function isAssistantPath(pathname) { return pathname === ASSISTANT_VOICE_PATH || pathname === ASSISTANT_TEXT_PATH || pathname === ASSISTANT_SPEECH_PATH || pathname === ASSISTANT_VISUALS_PATH || pathname === ASSISTANT_USAGE_PATH || pathname === ASSISTANT_MODELS_PATH || pathname === STUDIO_CHAT_PATH || pathname === STUDIO_RUN_PATH || pathname === STUDIO_RUNNER_STATUS_PATH; }
function isAccountActionsPath(pathname) { return pathname === ACCOUNT_ACTIONS_PATH || pathname.startsWith(`${ACCOUNT_ACTIONS_PATH}/`); }
function isAccountAutomationsPath(pathname) { return pathname === ACCOUNT_AUTOMATIONS_PATH || pathname.startsWith(`${ACCOUNT_AUTOMATIONS_PATH}/`); }
function isAccountFilesPath(pathname) { return pathname === ACCOUNT_FILES_PATH || pathname.startsWith(`${ACCOUNT_FILES_PATH}/`); }
function isAccountTasksPath(pathname) { return pathname === ACCOUNT_TASKS_PATH || pathname.startsWith(`${ACCOUNT_TASKS_PATH}/`); }
function isAccountWorkspacePath(pathname) { return pathname === ACCOUNT_PREFERENCES_PATH || pathname === ACCOUNT_AUDITS_PATH || pathname === STUDIO_PROJECTS_PATH || pathname.startsWith(`${STUDIO_PROJECTS_PATH}/`); }
function isCinematicsPath(pathname) { return pathname === CINEMATICS_PREFIX || pathname.startsWith(`${CINEMATICS_PREFIX}/`); }
function isCredentialedProductPath(pathname) { return pathname === ACCOUNT_ENTITLEMENT_PATH || pathname === ACTION_PLAN_PATH || isAccountWorkspacePath(pathname) || isAccountActionsPath(pathname) || isAccountAutomationsPath(pathname) || isAccountFilesPath(pathname) || isAccountTasksPath(pathname) || isCinematicsPath(pathname); }

export default {
  async fetch(request, env, ctx) {
    const pathname = new URL(request.url).pathname;
    if (request.method === "GET" && pathname === "/") return renderLandingPage();
    if (request.method === "GET" && pathname === "/health") {
      const response = await entry.fetch(request, env, ctx);
      if (!response.ok || !response.headers.get("content-type")?.includes("application/json")) return applyApiCors(response);
      try { const body = await response.json(); return applyApiCors(Response.json({ ...body, version: PRODUCT_VERSION, protocol: body?.protocol || COMPATIBLE_PROTOCOL, core_version: body?.version || null }, { status: response.status, headers: { "cache-control": "no-store" } })); } catch { return applyApiCors(response); }
    }
    if (request.method === "OPTIONS" && (isAuthPath(pathname) || isCredentialedProductPath(pathname))) return authPreflightResponse(request, env);
    if (request.method === "OPTIONS" && isAssistantPath(pathname)) return assistantPreflightResponse(request, env);
    if (request.method === "OPTIONS") return apiCorsPreflightResponse();

    if (request.method === "POST" && pathname === STRIPE_WEBHOOK_PATH) return handleStripeWebhook(request, env);
    if (request.method === "POST" && pathname === AUDIT_INTAKE_PATH) return applyApiCors(await handleAuditIntake(request, env));
    if (request.method === "POST" && pathname === AUDIT_STATUS_PATH) return applyApiCors(await handleAuditStatus(request, env));
    const checkoutMatch = pathname.match(/^\/admin\/audit\/intakes\/(ati_[a-f0-9]{32})\/checkout$/);
    if (checkoutMatch && request.method === "POST") {
      if (!auditAdminAuthorized(request, env)) return Response.json({ error: "admin_auth_required" }, { status: 401, headers: { "cache-control": "no-store" } });
      return createAuditCheckoutSession(request, env, checkoutMatch[1]);
    }
    if (pathname === AUDIT_ADMIN_PREFIX || pathname.startsWith(`${AUDIT_ADMIN_PREFIX}/`)) return handleAuditAdmin(request, env, pathname);
    if (isAuthPath(pathname)) return applyAuthCors(await handleProofTTLAuth(request, env), request, env);

    if (isCinematicsPath(pathname)) {
      const entitlement = pathname === "/cinematics/render"
        ? await resolveAssistantEntitlement(request, env, assistantQuotaLimit(env))
        : null;
      return applyAuthCors(await handleCinematics(request, env, pathname, entitlement), request, env);
    }

    if (isAccountWorkspacePath(pathname)) return applyAuthCors(await handleAccountWorkspace(request, env, pathname), request, env);
    if (isAccountActionsPath(pathname)) return applyAuthCors(await handleAccountActions(request, env, pathname), request, env);
    if (isAccountAutomationsPath(pathname)) return applyAuthCors(await handleAccountAutomations(request, env, pathname), request, env);
    if (isAccountFilesPath(pathname)) return applyAuthCors(await handleAccountFiles(request, env, pathname), request, env);
    if (isAccountTasksPath(pathname)) return applyAuthCors(await handleAccountTasks(request, env, pathname), request, env);

    if (request.method === "GET" && pathname === ACCOUNT_ENTITLEMENT_PATH) {
      const entitlement = await resolveAssistantEntitlement(request, env, assistantQuotaLimit(env));
      if (!entitlement.authenticated) return applyAuthCors(Response.json({ error: "authentication_required", message: "Sign in to read account entitlement status." }, { status: 401, headers: { "cache-control": "no-store" } }), request, env);
      return applyAuthCors(Response.json({ account: { plan: entitlement.plan, membership_status: entitlement.membership_status, assistant_daily_limit: entitlement.limit, period_end_ms: entitlement.period_end_ms || null }, billing: { enabled: false, self_service_upgrade: false } }, { headers: { "cache-control": "no-store" } }), request, env);
    }
    if (request.method === "GET" && pathname === READINESS_PATH) return applyApiCors(Response.json(await getDeploymentReadiness(env, request), { headers: { "cache-control": "no-store" } }));
    if (request.method === "GET" && pathname === CAPABILITIES_PATH) return applyApiCors(Response.json(capabilityRegistry(env), { headers: { "cache-control": "no-store" } }));
    if (request.method === "POST" && pathname === COMMAND_PLAN_PATH) {
      const body = await request.json().catch(() => null);
      if (!body || typeof body.command !== "string") return applyApiCors(Response.json({ error: "command_required" }, { status: 400, headers: { "cache-control": "no-store" } }));
      return applyApiCors(Response.json(planNaturalLanguageCommand(body.command), { headers: { "cache-control": "no-store" } }));
    }
    if (pathname === ACTION_PLAN_PATH) return applyAuthCors(await handleActionPlan(request, env), request, env);

    if (request.method === "GET" && pathname === AUTH_DISCOVERY_PATH) {
      const status = authRuntimeStatus(env, request);
      return applyApiCors(Response.json({ service: "ProofTTL Auth", backend: "better-auth", endpoint: `${AUTH_PATH_PREFIX}/*`, configured: status.configured, database: status.database, sign_in: { github: status.socialProviders.github, google: status.socialProviders.google, discord: status.socialProviders.discord, email: status.emailSignIn, passkey: status.passkeys }, security: { totp: status.totp, recovery_codes: status.recoveryCodes, passkeys: status.passkeys, secure_http_only_sessions: true, origin_allowlist: true, csrf_protection: true } }, { headers: { "cache-control": "no-store" } }));
    }
    if (request.method === "GET" && pathname === ASSISTANT_USAGE_PATH) {
      const quota = await getAssistantQuota(request, env);
      return applyAssistantCors(Response.json({ service: "ProofTTL Assistant", version: PRODUCT_VERSION, quota, love: loveCapability(quota, env), membership: { available: false, note: "Paid assistant plans are not enabled yet; L.O.V.E. voice mode is temporarily available through the testnet preview." } }, { headers: { "cache-control": "no-store" } }), request, env);
    }
    if (request.method === "GET" && pathname === ASSISTANT_MODELS_PATH) return applyAssistantCors(Response.json({ service: "ProofTTL Model Catalog", catalog: assistantModelCatalog(env) }, { headers: { "cache-control": "no-store" } }), request, env);
    if (request.method === "GET" && pathname === STUDIO_RUNNER_STATUS_PATH) return applyAssistantCors(Response.json({ service: "ProofTTL Studio Runner", configured: runnerConfigured(env), provider: "vercel-sandbox", supported: ["javascript", "python", "bash"], unsupported: ["powershell"], isolation: { ephemeral: true, production_secrets_injected: false, network_default: "deny", max_code_chars: 25000, max_output_chars: 20000, timeout_ms: 15000 } }, { headers: { "cache-control": "no-store" } }), request, env);

    if (pathname === ASSISTANT_VOICE_PATH) return applyAssistantCors(await handleVoiceAssistant(request, env), request, env);
    if (pathname === ASSISTANT_TEXT_PATH) return applyAssistantCors(await handleTextAssistant(request, env, ctx), request, env);
    if (pathname === ASSISTANT_SPEECH_PATH) return applyAssistantCors(await handleAssistantSpeech(request, env), request, env);
    if (pathname === ASSISTANT_VISUALS_PATH) return applyAssistantCors(await handleAssistantVisuals(request), request, env);
    if (pathname === STUDIO_CHAT_PATH) return applyAssistantCors(await handleStudioChat(request, env), request, env);
    if (pathname === STUDIO_RUN_PATH) return applyAssistantCors(await handleStudioRun(request, env), request, env);

    if (request.method === "GET" && pathname === "/.well-known/proofttl-assistant.json") {
      const anonymousQuota = { plan: "free", membership_status: "anonymous" };
      return applyApiCors(Response.json({ service: "ProofTTL Assistant", version: PRODUCT_VERSION, persona: { name: "L.O.V.E.", role: "general workspace intelligence and control" }, interaction: "text_or_voice_input_with_optional_grounded_sources_visuals_and_final_response_voice_output", endpoints: { voice: ASSISTANT_VOICE_PATH, text: ASSISTANT_TEXT_PATH, speech: ASSISTANT_SPEECH_PATH, visuals: ASSISTANT_VISUALS_PATH, usage: ASSISTANT_USAGE_PATH, models: ASSISTANT_MODELS_PATH, capabilities: CAPABILITIES_PATH, command_plan: COMMAND_PLAN_PATH, action_plan: ACTION_PLAN_PATH, account_actions: ACCOUNT_ACTIONS_PATH, account_automations: ACCOUNT_AUTOMATIONS_PATH, account_files: ACCOUNT_FILES_PATH, account_tasks: ACCOUNT_TASKS_PATH, studio: STUDIO_CHAT_PATH, studio_runner: STUDIO_RUN_PATH, cinematics_plan: "/cinematics/plan", cinematics_storyboard: "/cinematics/storyboard", cinematics_render: "/cinematics/render" }, endpoint: ASSISTANT_VOICE_PATH, input: { voice_content_type: "audio/*", text_content_type: "application/json", max_audio_bytes: Number(env.PROOFTTL_ASSISTANT_MAX_AUDIO_BYTES) || ASSISTANT_LIMITS.maxAudioBytes }, output: { text: true, voice: true, visuals: true, visual_provider: ASSISTANT_VISUALS.provider, visual_max_results: ASSISTANT_VISUALS.maxResults, voice_encoding: "mp3", voice_source: "final_response_text", voice_capability: loveCapability(anonymousQuota, env) }, grounding: { fact_lease_ids: true, source: "live_lease_storage", missing_lease_behavior: "refuse_to_invent", visual_sources: "provider_returned_only" }, quota: { free_daily_messages: assistantQuotaLimit(env), shared_between_text_and_voice: true, reset: "daily_utc", durable_accounting: Boolean(env?.MONITOR_DB), account_entitlements: true, authenticated_browser_sessions_supported: true }, scope: "general_workspace_assistant_with_connected_capability_boundaries", models: ASSISTANT_MODELS, navigation: "allowlisted_non_destructive_only", persistent_actions: "explicit_user_confirmation_required", audio_retention: "none_by_default", free_capacity_behavior: "fail_closed_no_paid_fallback", configured: Boolean(env?.AI && env?.ASSISTANT_RATE_LIMITER) }, { headers: { "cache-control": "public, max-age=60" } }));
    }
    return applyApiCors(await entry.fetch(request, env, ctx));
  },
  async scheduled(controller, env, ctx) { if (typeof entry.scheduled === "function") return entry.scheduled(controller, env, ctx); }
};