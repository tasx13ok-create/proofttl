// Deliberately allowlisted telemetry: no request URL, headers, input, source or result body.
const EVENTS = new Set(['auth','mcp_initialize','tool_invocation','audit_creation','lease_issuance','refusal','request_complete','timeout','server_error']);
const TOOLS = new Set(['audit_claim','audit_output','challenge_claim','compare_evidence','create_fact_lease','get_fact_lease']);
const CATEGORIES = new Set(['success','authentication_required','invalid_token','expired_token','wrong_resource','insufficient_scope','revoked_token','configuration_unavailable','origin_forbidden','invalid_request','rate_limited','timeout','cancelled','refused','internal_error']);
const encoder = new TextEncoder();

export function safeEvent(event, fields = {}) {
  if (!EVENTS.has(event)) return null;
  const value = { service: 'proofttl', environment: 'auth-preview', event };
  if (/^[a-f0-9]{32}$/.test(fields.request_id || '')) value.request_id = fields.request_id;
  if (/^[a-f0-9]{24}$/.test(fields.tenant_tag || '')) value.tenant_tag = fields.tenant_tag;
  if (TOOLS.has(fields.tool)) value.tool = fields.tool;
  if (CATEGORIES.has(fields.category)) value.category = fields.category;
  if (Number.isInteger(fields.status) && fields.status >= 100 && fields.status <= 599) value.status = fields.status;
  if (Number.isFinite(fields.latency_ms) && fields.latency_ms >= 0) value.latency_ms = Math.min(120000, Math.round(fields.latency_ms));
  return value;
}

export async function createObserver(env, tenantId) {
  if (env?.PROOFTTL_OBSERVABILITY !== 'true') return { emit() {} };
  const request_id = crypto.randomUUID().replaceAll('-', '');
  let tenant_tag;
  const secret = env.PROOFTTL_OBSERVABILITY_SECRET;
  if (tenantId && typeof secret === 'string' && encoder.encode(secret).length >= 32) {
    try {
      const key = await crypto.subtle.importKey('raw', encoder.encode(secret), {name:'HMAC',hash:'SHA-256'}, false, ['sign']);
      const digest = new Uint8Array(await crypto.subtle.sign('HMAC',key,encoder.encode(tenantId)));
      tenant_tag = Array.from(digest.slice(0,12),b=>b.toString(16).padStart(2,'0')).join('');
    } catch { /* Telemetry never changes authorization or exposes exception text. */ }
  }
  return { emit(event, fields = {}) {
    const value = safeEvent(event, {...fields,request_id,tenant_tag});
    if (value) console.log(JSON.stringify(value));
  } };
}

export function errorCategory(error) {
  const code = error?.code;
  if (['authentication_required'].includes(code)) return 'authentication_required';
  if (['invalid_bearer_token','invalid_token'].includes(code)) return 'invalid_token';
  if (['expired_token','wrong_resource','insufficient_scope','revoked_token','origin_forbidden'].includes(code)) return code;
  if (['mcp_auth_not_configured','oauth_not_configured','mcp_origin_configuration_invalid'].includes(code)) return 'configuration_unavailable';
  if (code === 'mcp_rate_limit_exceeded') return 'rate_limited';
  if (error?.name === 'TimeoutError' || code === 'mcp_timeout') return 'timeout';
  if (error?.name === 'AbortError' || code === 'request_cancelled') return 'cancelled';
  if (Number.isInteger(error?.status) && error.status >= 400 && error.status < 500) return 'refused';
  return 'internal_error';
}
