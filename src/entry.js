import core from "./index.js";
import { DISCOVERY, OPENAPI, PRICING } from "./discovery.js";

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/.well-known/proofttl.json") {
      return machineJson(DISCOVERY);
    }

    if (request.method === "GET" && url.pathname === "/openapi.json") {
      return machineJson(OPENAPI);
    }

    if (request.method === "GET" && url.pathname === "/pricing") {
      return machineJson(PRICING);
    }

    return core.fetch(request, env, ctx);
  },

  async scheduled(controller, env, ctx) {
    if (typeof core.scheduled === "function") {
      return core.scheduled(controller, env, ctx);
    }
  }
};

function machineJson(value) {
  return new Response(JSON.stringify(value, null, 2), {
    status: 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "public, max-age=60",
      "access-control-allow-origin": "*"
    }
  });
}
