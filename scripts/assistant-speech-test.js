import assert from 'node:assert/strict';
import { handleAssistantSpeech, ASSISTANT_SPEECH_LIMITS } from '../src/assistant-speech.js';

let checks = 0;
function check(name, fn) {
  fn();
  checks += 1;
  console.log(`ok ${checks} - ${name}`);
}

function request(text = 'Hello from L.O.V.E.', headers = {}) {
  return new Request('https://proofttl.test/assistant/speech', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'cf-connecting-ip': '203.0.113.7', ...headers },
    body: JSON.stringify({ text })
  });
}

function env(overrides = {}) {
  return {
    PROOFTTL_LOVE_PUBLIC_PREVIEW: 'true',
    ASSISTANT_RATE_LIMITER: { async limit() { return { success: true }; } },
    AI: {
      async run(model, options) {
        assert.equal(model, '@cf/deepgram/aura-2-en');
        assert.equal(options.encoding, 'mp3');
        assert.equal(options.speaker, 'atlas');
        return new Uint8Array([1, 2, 3, 4]);
      }
    },
    ...overrides
  };
}

{
  let spoken = '';
  const response = await handleAssistantSpeech(request('  This   is the final response.  '), env({
    AI: { async run(model, options) { spoken = options.text; return new Uint8Array([9, 8, 7]); } }
  }));
  const body = await response.json();
  check('final-response speech returns HTTP 200', () => assert.equal(response.status, 200));
  check('speech normalizes and uses the exact submitted final text', () => assert.equal(spoken, 'This is the final response.'));
  check('speech response is MP3 and marked final_response_text', () => {
    assert.equal(body.speech.mime_type, 'audio/mpeg');
    assert.equal(body.speech.source, 'final_response_text');
    assert.ok(body.speech.audio_base64);
  });
}

{
  const response = await handleAssistantSpeech(new Request('https://proofttl.test/assistant/speech', {
    method: 'POST', headers: { 'content-type': 'text/plain' }, body: 'hello'
  }), env());
  check('non-JSON speech request is rejected', () => assert.equal(response.status, 415));
}

{
  const response = await handleAssistantSpeech(request(''), env());
  check('empty speech text is rejected', () => assert.equal(response.status, 400));
}

{
  let spoken = '';
  const input = 'x'.repeat(ASSISTANT_SPEECH_LIMITS.maxTextChars + 200);
  const response = await handleAssistantSpeech(request(input), env({
    AI: { async run(_model, options) { spoken = options.text; return new Uint8Array([1]); } }
  }));
  check('speech text is bounded before provider execution', () => {
    assert.equal(response.status, 200);
    assert.equal(spoken.length, ASSISTANT_SPEECH_LIMITS.maxTextChars);
  });
}

{
  const response = await handleAssistantSpeech(request('hello'), env({
    ASSISTANT_RATE_LIMITER: { async limit() { return { success: false }; } }
  }));
  check('speech rate limiting fails closed', () => assert.equal(response.status, 429));
}

{
  const response = await handleAssistantSpeech(request('hello'), env({ PROOFTTL_LOVE_PUBLIC_PREVIEW: 'false' }));
  check('speech respects voice capability gate', () => assert.equal(response.status, 403));
}

{
  const response = await handleAssistantSpeech(request('hello'), env({
    AI: { async run() { return new Uint8Array(); } }
  }));
  check('empty provider audio is rejected', () => assert.equal(response.status, 502));
}

console.log(`\n${checks} assistant speech checks passed.`);
