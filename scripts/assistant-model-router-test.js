import {
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
  const cloudflareEnv = {
    AI: { run: async (model, options) => ({ response: `ok:${model}:${options.messages.length}` }) }
  };

  const cloudflare = assistantModelRuntime(cloudflareEnv);
  assert(cloudflare.provider === 'cloudflare', 'Cloudflare is the default response provider');
  assert(assistantResponseProviderAvailable(cloudflareEnv), 'default provider is available with Workers AI binding');
  const nativeResult = await runAssistantResponse(cloudflareEnv, { messages: [{ role: 'user', content: 'hi' }] });
  assert(String(nativeResult.response).startsWith('ok:@cf/ibm-granite/'), 'default provider routes through configured Workers AI model');

  const insecureExternal = {
    PROOFTTL_RESPONSE_PROVIDER: 'openai-compatible',
    PROOFTTL_EXTERNAL_AI_BASE_URL: 'http://example.test/v1',
    PROOFTTL_EXTERNAL_AI_MODEL: 'example-model',
    PROOFTTL_EXTERNAL_AI_API_KEY: 'secret'
  };
  assert(!assistantResponseProviderAvailable(insecureExternal), 'external AI refuses non-HTTPS base URLs');

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
    const external = await runAssistantResponse(externalEnv, { messages: [{ role: 'user', content: 'hi' }] });
    assert(external.response === 'external-ok', 'external provider response is normalized for L.O.V.E.');
  } finally {
    globalThis.fetch = previousFetch;
  }

  console.log(`\nSUCCESS: ${passed} assistant model-router checks passed.`);
}

run().catch((error) => {
  console.error('\nASSISTANT MODEL ROUTER TEST FAILED:', error.stack || error.message);
  process.exitCode = 1;
});
