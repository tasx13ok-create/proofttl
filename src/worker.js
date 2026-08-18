import entry from "./entry.js";
import {
  applyApiCors,
  apiCorsPreflightResponse
} from "./http-cors.js";

export default {
  async fetch(request, env, ctx) {
    if (request.method === "OPTIONS") {
      return apiCorsPreflightResponse();
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
