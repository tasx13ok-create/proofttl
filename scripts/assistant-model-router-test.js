import {
  assistantModelCatalog,
  assistantModelRuntime,
  assistantResponseProviderAvailable,
  runAssistantResponse
} from '../src/assistant-model-router.js';

let passed = 0;
function assert(condition, message) {
  if (!condition) throw new Error(message);
  passed += 1;
  console.log(`PASS ${passed}: ${message}`);
}

async function run() {
  let capturedMessages = null;
  const cloudflareEnv = {
    AI: { run: async (model, options) => {
      capturedMessages = options.messages;
      return { response: `ok:${model}:${options.messages.length}` };
    } },
    PROOFTTL_CLOUDFLARE_MODEL_CATALOG: '@cf/meta/llama-3.1-8b-instruct,@cf/qwen/qwen3-30b-a3b-fp8'
  };

  const catalog = assistantModelCatalog(cloudflareEnv);
  assert(catalog.cloudflare.some((item) => item.model === '@cf/ibm-granite/granite-4.0-h-micro'), 'model catalog always includes deployment default');
  assert(catalog.cloudflare.some((item) => item.model === '@cf/meta/llama-3.1-8b-instruct'), 'configured Cloudflare model catalog is exposed');

  const cloudflare = assistantModelRuntime(cloudflareEnv);
  assert(cloudflare.provider === 'cloudflare', 'Cloudflare is the default response provider');
  assert(!cloudflare.preference_applied, 'default route is not mislabeled as account preference');
  assert(assistantResponseProviderAvailable(cloudflareEnv), 'default provider is available with Workers AI binding');
  const nativeResult = await runAssistantResponse(cloudflareEnv, { messages: [{ role: 'user', content: 'hi' }] });
  assert(String(nativeResult.response).startsWith('ok:@cf/ibm-granite/'), 'default provider routes through configured Workers AI model');
  assert(capturedMessages?.length === 1, 'non-assistant model calls are not modified by the ProofTTL scope override');

  await runAssistantResponse(cloudflareEnv, {
    messages: [
      { role: 'system', content: 'You are L.O.V.E., ProofTTL product intelligence.' },
      { role: 'user', content: 'why is the sky blue' }
    ]
  });
  const scopeMessage = capturedMessages?.find((item) => item.role === 'system' && /ProofTTL assistant scope is product-only/i.test(String(item.content || '')));
  assert(Boolean(scopeMessage), 'assistant calls receive the ProofTTL-only scope override');
  assert(/\$1,500 Fact Audit/i.test(scopeMessage?.content || ''), 'assistant scope pins the only paid audit offer');
  assert(/For unrelated requests, do not answer the substantive request/i.test(scopeMessage?.content || ''), 'assistant scope blocks general-purpose answers');
  assert(/Never invent live or private data/i.test(scopeMessage?.content || ''), 'assistant scope preserves private/live-data grounding boundary');
  assert(!/general-purpose intelligence|normal conversation/i.test(scopeMessage?.content || ''), 'legacy general-purpose override is absent');

  const allowedPreference = {
    preferred_ai_provider: 'cloudflare',
    preferred_ai_model: '@cf/meta/llama-3.1-8b-instruct'
  };
  const preferredRuntime = assistantModelRuntime(cloudflareEnv, allowedPreference);
  assert(preferredRuntime.preference_applied && preferredRuntime.response_model === allowedPreference.preferred_ai_model, 'allowlisted account model preference is honored');
  const preferredResult = await runAssistantResponse(cloudflareEnv, { messages: [{ role: 'user', content: 'hi' }] }, allowedPreference);
  assert(String(preferredResult.response).includes('@cf/meta/llama-3.1-8b-instruct'), 'allowlisted account model preference reaches Workers AI');

  const injectedPreference = {
    preferred_ai_provider: 'cloudflare',
    preferred_ai_model: '@cf/attacker/not-approved'
  };
  const rejectedRuntime = assistantModelRuntime(cloudflareEnv, injectedPreference);
  assert(!rejectedRuntime.preference_applied && rejectedRuntime.response_model === '@cf/ibm-granite/granite-4.0-h-micro', 'unapproved account model injection falls back to deployment default');

  const insecureExternal = {
    PROOFTTL_RESPONSE_PROVIDER: 'openai-compatible',
    PROOFTTL_EXTERNAL_AI_BASE_URL: 'http://example.test/v1',
    PROOFTTL_EXTERNAL_AI_MODEL: 'example-model',
    PROOFTTL_EXTERNAL_AI_API_KEY: 'secret'
  };
  assert(!assistantResponseProviderAvailable(insecureExternal), 'external AI refuses non-HTTPS base URLs');
  assert(assistantModelCatalog(insecureExternal).openai_compatible.length === 0, 'insecure external provider is omitted from public model catalog');

  const previousFetch = globalThis.fetch;
  try {
    globalThis.fetch = async (url, init) => {
      assert(url === 'https://models.example.test/v1/chat/completions', 'external adapter targets the OpenAI-compatible chat completions path');
      assert(init?.headers?.authorization === 'Bearer secret', 'external API key stays in server Authorization header');
      const request = JSON.parse(init.body);
      assert(request.model === 'example-model', 'external adapter sends configured model');
      return new Response(JSON.stringify({
        choices: [{ message: { content: 'external-ok' } }],
        usage: { prompt_tokens: 2, completion_tokens: 1 }
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    };

    const externalEnv = {
      PROOFTTL_RESPONSE_PROVIDER: 'openai-compatible',
      PROOFTTL_EXTERNAL_AI_BASE_URL: 'https://models.example.test/v1',
      PROOFTTL_EXTERNAL_AI_MODEL: 'example-model',
      PROOFTTL_EXTERNAL_AI_API_KEY: 'secret'
    };
    assert(assistantResponseProviderAvailable(externalEnv), 'HTTPS OpenAI-compatible provider becomes available only when all server configuration exists');
    assert(assistantModelCatalog(externalEnv).openai_compatible.some((item) => item.model === 'example-model'), 'configured HTTPS external model appears in safe catalog');
    const external = await runAssistantResponse(externalEnv, { messages: [{ role: 'user', content: 'hi' }] });
    assert(external.response === 'external-ok', 'external provider response is normalized');
  } finally {
    globalThis.fetch = previousFetch;
  }

  console.log(`\nSUCCESS: ${passed} assistant model-router checks passed.`);
}

run().catch((error) => {
  console.error('\nASSISTANT MODEL ROUTER TEST FAILED:', error.stack || error.message);
  process.exitCode = 1;
});
