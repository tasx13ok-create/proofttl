import entry from "./entry.js";
import { handleVoiceAssistant, ASSISTANT_LIMITS, ASSISTANT_MODELS } from "./assistant.js";
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

const ASSISTANT_PATH = "/assistant/voice";
const AUTH_DISCOVERY_PATH = "/.well-known/proofttl-auth.json";

function isAuthPath(pathname) {
  return pathname === AUTH_PATH_PREFIX || pathname.startsWith(`${AUTH_PATH_PREFIX}/`);
}

export default {
  async fetch(request, env, ctx) {
    const pathname = new URL(request.url).pathname;

    if (request.method === "OPTIONS" && isAuthPath(pathname)) {
      return authPreflightResponse(request, env);
    }

    if (request.method === "OPTIONS") {
      return apiCorsPreflightResponse();
    }

    if (isAuthPath(pathname)) {
      const response = await handleProofTTLAuth(request, env);
      return applyAuthCors(response, request, env);
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

    if (pathname === ASSISTANT_PATH) {
      const response = await handleVoiceAssistant(request, env);
      return applyApiCors(response);
    }

    if (request.method === "GET" && pathname === "/.well-known/proofttl-assistant.json") {
      return applyApiCors(
        Response.json(
          {
            service: "ProofTTL Assistant",
            interaction: "voice_input_text_output",
            endpoint: ASSISTANT_PATH,
            input: {
              content_type: "audio/*",
              max_bytes: Number(env.PROOFTTL_ASSISTANT_MAX_AUDIO_BYTES) || ASSISTANT_LIMITS.maxAudioBytes
            },
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
