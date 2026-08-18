import entry from "./entry.js";
import { handleVoiceAssistant, ASSISTANT_LIMITS, ASSISTANT_MODELS } from "./assistant.js";
import {
  applyApiCors,
  apiCorsPreflightResponse
} from "./http-cors.js";

const ASSISTANT_PATH = "/assistant/voice";

export default {
  async fetch(request, env, ctx) {
    if (request.method === "OPTIONS") {
      return apiCorsPreflightResponse();
    }

    const pathname = new URL(request.url).pathname;

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
