import coreWorker from "./worker.js";
import { handleFoundry, runFoundryScheduled } from "./foundry.js";
import { applyAuthCors, authPreflightResponse } from "./auth-cors.js";

function isFoundryPath(pathname) {
  return pathname === "/foundry/runs" || pathname.startsWith("/foundry/runs/");
}

export default {
  async fetch(request, env, ctx) {
    const pathname = new URL(request.url).pathname;
    if (!isFoundryPath(pathname)) return coreWorker.fetch(request, env, ctx);
    if (request.method === "OPTIONS") return authPreflightResponse(request, env);
    return applyAuthCors(await handleFoundry(request, env, pathname), request, env);
  },
  async scheduled(controller, env, ctx) {
    const jobs = [runFoundryScheduled(env)];
    if (typeof coreWorker.scheduled === "function") jobs.push(coreWorker.scheduled(controller, env, ctx));
    await Promise.allSettled(jobs);
  }
};
