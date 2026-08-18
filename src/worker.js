import entry from "./entry.js";
import { handleVoiceAssistant, loveCapability, ASSISTANT_LIMITS, ASSISTANT_MODELS } from "./assistant.js";
import { handleTextAssistant } from "./assistant-text.js";
import {
  assistantQuotaLimit,
  getAssistantQuota
} from "./assistant-quota.js";
import {
  applyAssistantCors,
  assistantPreflightResponse
} from "./assistant-cors.js";
import {
  AUTH_PATH_PREFIX,
  authRuntimeStatus,
  handleProofTTLAuth
} from "./auth.js";
import {
  applyAuthCors,
  authPreflightResponse
} from "./auth-cors.js";
import {
  applyApiCors,
  apiCorsPreflightResponse
} from "./http-cors.js";
import { resolveAssistantEntitlement } from "./entitlements.js";
import { getDeploymentReadiness } from "./readiness.js";
import { renderLandingPage } from "./site.js";

const ASSISTANT_VOICE_PATH = "/assistant/voice";
const ASSISTANT_TEXT_PATH = "/assistant/text";
const ASSISTANT_USAGE_PATH = "/assistant/usage";
const ACCOUNT_ENTITLEMENT_PATH = "/account/entitlement";
const READINESS_PATH = "/readiness";
const AUTH_DISCOVERY_PATH = "/.well-known/proofttl-auth.json";

function isAuthPath(pathname) {
  return pathname === AUTH_PATH_PREFIX || pathname.startsWith(`${AUTH_PATH_PREFIX}/`);
}

function isAssistantPath(pathname) {
  return pathname === ASSISTANT_VOICE_PATH ||
    pathname === ASSISTANT_TEXT_PATH ||
    pathname === ASSISTANT_USAGE_PATH;
}

function isCredentialedProductPath(pathname) {
  return pathname === ACCOUNT_ENTITLEMENT_PATH;
}

export default {
  async fetch(request, env, ctx) {
    const pathname = new URL(request.url).pathname;

    if (request.method === "GET" && pathname === "/") {
      return renderLandingPage();
    }

    if (request.method === "OPTIONS" && (isAuthPath(pathname) || isCredentialedProductPath(pathname))) {
      return authPreflightResponse(request, env);
    }

    if (request.method === "OPTIONS" && isAssistantPath(pathname)) {
      return assistantPreflightResponse(request, env);
    }

    if (request.method === "OPTIONS") {
      return apiCorsPreflightResponse();
    }

    if (isAuthPath(pathname)) {
      const response = await handleProofTTLAuth(request, env);
      return applyAuthCors(response, request, env);
    }

    if (request.method === "GET" && pathname === ACCOUNT_ENTITLEMENT_PATH) {
      const entitlement = await resolveAssistantEntitlement(request, env, assistantQuotaLimit(env));
      if (!entitlement.authenticated) {
        return applyAuthCors(
          Response.json(
            { error: "authentication_required", message: "Sign in to read account entitlement status." },
            { status: 401, headers: { "cache-control": "no-store" } }
          ),
          request,
          env
        );
      }

      return applyAuthCors(
        Response.json(
          {
            account: {
              plan: entitlement.plan,
              membership_status: entitlement.membership_status,
              assistant_daily_limit: entitlement.limit,
              period_end_ms: entitlement.period_end_ms || null
            },
            billing: {
              enabled: false,
              self_service_upgrade: false
            }
          },
          { headers: { "cache-control": "no-store" } }
        ),
        request,
        env
      );
    }

    if (request.method === "GET" && pathname === READINESS_PATH) {
      const readiness = await getDeploymentReadiness(env, request);
      return applyApiCors(
        Response.json(readiness, { headers: { "cache-control": "no-store" } })
      );
    }

    if (request.method === "GET" && pathname === AUTH_DISCOVERY_PATH) {
      const status = authRuntimeStatus(env, request);
      return applyApiCors(
        Response.json(
          {
            service: "ProofTTL Auth",
            backend: "better-auth",
            endpoint: `${AUTH_PATH_PREFIX}/*`,
            configured: status.configured,
            database: status.database,
            sign_in: {
              github: status.socialProviders.github,
              google: status.socialProviders.google,
              discord: status.socialProviders.discord,
              email: status.emailSignIn,
              passkey: status.passkeys
            },
            security: {
              totp: status.totp,
              recovery_codes: status.recoveryCodes,
              passkeys: status.passkeys,
              secure_http_only_sessions: true,
              origin_allowlist: true,
              csrf_protection: true
            }
          },
          { headers: { "cache-control": "no-store" } }
        )
      );
    }

    if (request.method === "GET" && pathname === ASSISTANT_USAGE_PATH) {
      const quota = await getAssistantQuota(request, env);
      return applyAssistantCors(
        Response.json(
          {
            service: "ProofTTL Assistant",
            quota,
            love: loveCapability(quota, env),
            membership: {
              available: false,
              note: "Paid assistant plans are not enabled yet; L.O.V.E. voice mode is temporarily available through the testnet preview."
            }
          },
          { headers: { "cache-control": "no-store" } }
        ),
        request,
        env
      );
    }

    if (pathname === ASSISTANT_VOICE_PATH) {
      const response = await handleVoiceAssistant(request, env);
      return applyAssistantCors(response, request, env);
    }

    if (pathname === ASSISTANT_TEXT_PATH) {
      const response = await handleTextAssistant(request, env, ctx);
      return applyAssistantCors(response, request, env);
    }

    if (request.method === "GET" && pathname === "/.well-known/proofttl-assistant.json") {
      const anonymousQuota = {
        plan: "free",
        membership_status: "anonymous"
      };
      return applyApiCors(
        Response.json(
          {
            service: "ProofTTL Assistant",
            persona: {
              name: "L.O.V.E.",
              expansion: "Lease Offering Value Interpreter"
            },
            interaction: "text_or_voice_input_text_and_optional_voice_output",
            endpoints: {
              voice: ASSISTANT_VOICE_PATH,
              text: ASSISTANT_TEXT_PATH,
              usage: ASSISTANT_USAGE_PATH
            },
            endpoint: ASSISTANT_VOICE_PATH,
            input: {
              voice_content_type: "audio/*",
              text_content_type: "application/json",
              max_audio_bytes: Number(env.PROOFTTL_ASSISTANT_MAX_AUDIO_BYTES) || ASSISTANT_LIMITS.maxAudioBytes
            },
            output: {
              text: true,
              voice: true,
              voice_encoding: "mp3",
              voice_capability: loveCapability(anonymousQuota, env)
            },
            quota: {
              free_daily_messages: assistantQuotaLimit(env),
              shared_between_text_and_voice: true,
              reset: "daily_utc",
              durable_accounting: Boolean(env?.MONITOR_DB),
              account_entitlements: true,
              authenticated_browser_sessions_supported: true
            },
            scope: "proofttl_product_only",
            models: ASSISTANT_MODELS,
            navigation: "allowlisted_non_destructive_only",
            persistent_actions: "explicit_user_confirmation_required",
            audio_retention: "none_by_default",
            free_capacity_behavior: "fail_closed_no_paid_fallback",
            configured: Boolean(env?.AI && env?.ASSISTANT_RATE_LIMITER)
          },
          { headers: { "cache-control": "public, max-age=60" } }
        )
      );
    }

    const response = await entry.fetch(request, env, ctx);
    return applyApiCors(response);
  },

  async scheduled(controller, env, ctx) {
    if (typeof entry.scheduled === "function") {
      return entry.scheduled(controller, env, ctx);
    }
  }
};
