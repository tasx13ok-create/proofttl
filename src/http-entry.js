import worker from "./entry.js";
import { browserPreflightResponse, withBrowserCors } from "./browser-cors.js";

export default {
  async fetch(request, env, ctx) {
    if (request.method === "OPTIONS") {
      return browserPreflightResponse();
    }

    const response = await worker.fetch(request, env, ctx);
    return withBrowserCors(response);
  },

  async scheduled(controller, env, ctx) {
    if (typeof worker.scheduled === "function") {
      return worker.scheduled(controller, env, ctx);
    }
  }
};
