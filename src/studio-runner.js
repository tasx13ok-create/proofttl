import { getOptionalProofTTLSession } from './auth.js';

const VERCEL_API = 'https://api.vercel.com/v2';
const MAX_CODE_CHARS = 25000;
const MAX_OUTPUT_CHARS = 20000;
const JOB_TIMEOUT_MS = 15000;

const RUNTIMES = Object.freeze({
  javascript: { runtime: 'node24', file: 'main.mjs', command: 'node' },
  python: { runtime: 'python3.13', file: 'main.py', command: 'python' },
  bash: { runtime: 'node24', file: 'main.sh', command: 'bash' },
});

export async function handleStudioRun(request, env) {
  if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405, { allow: 'POST, OPTIONS' });
  if (!runnerConfigured(env)) return json({ error: 'studio_runner_not_configured', message: 'The isolated Studio runner is not connected on this deployment.' }, 503);

  const session = await getOptionalProofTTLSession(request, env);
  const userId = session?.user?.id;
  if (!userId) return json({ error: 'authentication_required', message: 'Sign in before running isolated code jobs.' }, 401);

  const limiter = env?.ASSISTANT_RATE_LIMITER;
  if (!limiter || typeof limiter.limit !== 'function') return json({ error: 'studio_runner_rate_limiter_unavailable' }, 503);
  const limited = await limiter.limit({ key: `studio-run:${String(userId).slice(0, 80)}` });
  if (!limited?.success) return json({ error: 'studio_runner_rate_limited', message: 'Too many code jobs. Try again shortly.' }, 429, { 'retry-after': '60' });

  let body;
  try { body = await request.json(); } catch { return json({ error: 'invalid_json' }, 400); }
  const language = clean(body?.language, 30).toLowerCase();
  const code = typeof body?.code === 'string' ? body.code.slice(0, MAX_CODE_CHARS + 1) : '';
  const spec = RUNTIMES[language];
  if (!spec) return json({ error: 'unsupported_runtime', supported: Object.keys(RUNTIMES), message: 'Current isolated runner supports JavaScript, Python, and Bash.' }, 400);
  if (!code) return json({ error: 'code_required' }, 400);
  if (code.length > MAX_CODE_CHARS) return json({ error: 'code_too_large', max_chars: MAX_CODE_CHARS }, 413);

  const token = clean(env.VERCEL_SANDBOX_TOKEN, 1000);
  const projectId = clean(env.VERCEL_SANDBOX_PROJECT_ID, 200);
  const teamId = clean(env.VERCEL_SANDBOX_TEAM_ID, 200);
  const name = `pttl-${crypto.randomUUID().replaceAll('-', '').slice(0, 24)}`;
  let sessionId = '';

  try {
    const created = await vercelFetch(env, `/sandboxes${query({ teamId })}`, {
      method: 'POST',
      body: JSON.stringify({
        name,
        projectId,
        runtime: spec.runtime,
        resources: { vcpus: '1', memory: '2048' },
        timeout: String(JOB_TIMEOUT_MS + 5000),
        persistent: false,
        ports: [],
        networkPolicy: {
          mode: 'custom',
          allowedDomains: [],
          allowedCIDRs: [],
          deniedCIDRs: []
        },
        tags: { product: 'proofttl-studio', mode: 'ephemeral-user-code' }
      })
    });
    if (!created.ok) return upstreamError('sandbox_create_failed', created.status);
    const createBody = await created.json().catch(() => ({}));
    sessionId = clean(createBody?.session?.id || createBody?.sandbox?.id, 200);
    if (!sessionId) return upstreamError('sandbox_session_missing', 502);

    const codeB64 = bytesToBase64(new TextEncoder().encode(code));
    const shell = `printf '%s' "$PROOFTTL_CODE_B64" | base64 -d > ${spec.file} && ${spec.command} ${spec.file}`;
    const cmdId = `cmd_${crypto.randomUUID().replaceAll('-', '')}`;
    const commandResponse = await vercelFetch(env, `/sandboxes/sessions/${encodeURIComponent(sessionId)}/cmd${query({ cmdId, teamId })}`, {
      method: 'POST',
      body: JSON.stringify({
        command: 'sh',
        args: ['-lc', shell],
        cwd: '/home/vercel-sandbox',
        env: { PROOFTTL_CODE_B64: codeB64 },
        sudo: false,
        wait: true,
        logs: true,
        timeout: String(JOB_TIMEOUT_MS)
      })
    });

    const commandBody = await commandResponse.json().catch(() => ({}));
    if (!commandResponse.ok) {
      return json({
        error: 'sandbox_command_failed',
        status: commandResponse.status,
        output: boundedOutput(extractOutput(commandBody)),
        runtime: { language, image: spec.runtime, network: 'deny-by-default', timeout_ms: JOB_TIMEOUT_MS }
      }, 502);
    }

    return json({
      ok: true,
      job: {
        id: cmdId,
        language,
        exit_code: extractExitCode(commandBody),
        output: boundedOutput(extractOutput(commandBody)),
        truncated: extractOutput(commandBody).length > MAX_OUTPUT_CHARS
      },
      isolation: {
        provider: 'vercel-sandbox',
        runtime: spec.runtime,
        vcpus: 1,
        memory_mb: 2048,
        network: 'deny-by-default',
        timeout_ms: JOB_TIMEOUT_MS,
        persistent: false,
        production_secrets_injected: false
      }
    });
  } catch (error) {
    console.warn(JSON.stringify({ event: 'studio_runner_failed', error: error?.name || error?.message || 'Error' }));
    return json({ error: 'studio_runner_unavailable', message: 'The isolated runner could not complete this job.' }, 503);
  } finally {
    if (sessionId) {
      void vercelFetch(env, `/sandboxes/sessions/${encodeURIComponent(sessionId)}/stop${query({ teamId })}`, { method: 'POST' }).catch(() => {});
    }
    void vercelFetch(env, `/sandboxes/${encodeURIComponent(name)}${query({ projectId, teamId })}`, { method: 'DELETE' }).catch(() => {});
    void token;
  }
}

export function runnerConfigured(env) {
  return Boolean(clean(env?.VERCEL_SANDBOX_TOKEN, 1000) && clean(env?.VERCEL_SANDBOX_PROJECT_ID, 200));
}

async function vercelFetch(env, path, init = {}) {
  const token = clean(env?.VERCEL_SANDBOX_TOKEN, 1000);
  return fetch(`${VERCEL_API}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${token}`,
      ...(init.body ? { 'content-type': 'application/json' } : {}),
      ...(init.headers || {})
    }
  });
}

function extractOutput(body) {
  const candidates = [
    body?.stdout,
    body?.output,
    body?.result?.stdout,
    body?.command?.stdout,
    body?.command?.output,
    body?.logs,
  ];
  const direct = candidates.find((item) => typeof item === 'string');
  if (direct) return direct;
  if (Array.isArray(body?.logs)) return body.logs.map((item) => typeof item === 'string' ? item : item?.message || '').filter(Boolean).join('\n');
  return '';
}

function extractExitCode(body) {
  for (const value of [body?.exitCode, body?.exit_code, body?.result?.exitCode, body?.command?.exitCode]) {
    if (Number.isInteger(Number(value))) return Number(value);
  }
  return null;
}

function boundedOutput(value) { return String(value || '').slice(0, MAX_OUTPUT_CHARS); }
function bytesToBase64(bytes) {
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  return btoa(binary);
}
function query(values) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) if (value) params.set(key, value);
  const text = params.toString();
  return text ? `?${text}` : '';
}
function clean(value, max) { return typeof value === 'string' ? value.trim().slice(0, max) : ''; }
function upstreamError(error, status) { return json({ error, upstream_status: status }, 502); }
function json(body, status = 200, extraHeaders = {}) { return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...extraHeaders } }); }
