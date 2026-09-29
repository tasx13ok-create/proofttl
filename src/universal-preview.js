import { handleMcpRequest } from './mcp/handler.js';
import { pruneCanonicalAudits } from './audits/service.js';
import { publicSigningJwk } from './lease-signing.js';
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/mcp') return handleMcpRequest(request, env);
    if (request.method === 'GET' && url.pathname === '/.well-known/proofttl-keys.json') {
      const key = publicSigningJwk(env.PROOFTTL_SIGNING_PRIVATE_JWK, env.PROOFTTL_SIGNING_KEY_ID);
      return Response.json({ service:'ProofTTL', environment:'isolated-preview', attestation_version:'proofttl-issuance-v2', keys:key?[key]:[] });
    }
    if (request.method === 'GET' && url.pathname === '/health') return Response.json({ ok:true, service:'ProofTTL', environment:'isolated-preview', mcp:'/mcp' });
    return Response.json({error:'not_found'}, {status:404});
  },
  async scheduled(controller, env, ctx) { ctx.waitUntil(pruneCanonicalAudits(env, controller.scheduledTime)); }
};
