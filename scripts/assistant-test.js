import assert from "node:assert/strict";
import {
  assistantSystemPrompt,
  handleVoiceAssistant,
  loveCapability,
  matchAssistantNavigation
} from "../src/assistant.js";
import { DEFAULT_ASSISTANT_RESPONSE_MODEL } from "../src/assistant-model-router.js";

const TRANSCRIPTION_MODEL = "@cf/openai/whisper-large-v3-turbo";

let checks = 0;
function check(name, fn) {
  fn();
  checks += 1;
  console.log(`ok ${checks} - ${name}`);
}

function audioRequest(body = new Uint8Array([1, 2, 3]), headers = {}) {
  return new Request("https://proofttl.test/assistant/voice", {
    method: "POST",
    headers: {
      "content-type": "audio/webm;codecs=opus",
      "cf-connecting-ip": "203.0.113.5",
      ...headers
    },
    body
  });
}

function limiter(success = true) {
  return {
    calls: [],
    async limit(input) {
      this.calls.push(input);
      return { success };
    }
  };
}

check("navigation requires a navigation verb", () => {
  assert.equal(matchAssistantNavigation("what are payments"), null);
});

check("payments navigation is allowlisted", () => {
  assert.deepEqual(matchAssistantNavigation("take me to payments"), {
    section: "payments",
    route: "/console/",
    label: "Payments"
  });
});

check("security navigation is allowlisted", () => {
  assert.deepEqual(matchAssistantNavigation("open my security settings"), {
    section: "security",
    route: "/console/",
    label: "Security"
  });
});

check("main menu navigation resolves to Workspace", () => {
  assert.deepEqual(matchAssistantNavigation("go to the main menu"), {
    section: "home",
    route: "/workspace/",
    label: "Workspace"
  });
});

check("arbitrary navigation target is rejected", () => {
  assert.equal(matchAssistantNavigation("open javascript alert dot com"), null);
});

check("assistant prompt forbids fabricated account state", () => {
  assert.match(assistantSystemPrompt(), /Never invent account data/i);
});

check("assistant prompt supports normal conversation", () => {
  assert.match(assistantSystemPrompt(), /Talk naturally/i);
  assert.doesNotMatch(assistantSystemPrompt(), /Answer only questions about ProofTTL/i);
});

check("owner plan gets member-only L.O.V.E. voice without public preview", () => {
  const capability = loveCapability(
    { plan: "owner", membership_status: "active" },
    { PROOFTTL_LOVE_PUBLIC_PREVIEW: "false" }
  );
  assert.equal(capability.voice_mode, true);
  assert.equal(capability.plan, "owner");
});

check("voice test tracks current Whisper transcription contract", () => {
  assert.equal(TRANSCRIPTION_MODEL, "@cf/openai/whisper-large-v3-turbo");
});

{
  let aiCalls = 0;
  let transcriptionOptions = null;
  const response = await handleVoiceAssistant(audioRequest(), {
    AI: {
      async run(model, options) {
        aiCalls += 1;
        assert.equal(model, TRANSCRIPTION_MODEL);
        transcriptionOptions = options;
        return { text: "Take me to payments" };
      }
    },
    ASSISTANT_RATE_LIMITER: limiter()
  });
  const body = await response.json();

  check("voice transcription enables English conversational VAD", () => {
    assert.equal(transcriptionOptions?.language, "en");
    assert.equal(transcriptionOptions?.vad_filter, true);
    assert.equal(transcriptionOptions?.condition_on_previous_text, false);
    assert.match(transcriptionOptions?.initial_prompt || "", /can you hear me/i);
  });
  check("deterministic navigation returns HTTP 200", () => assert.equal(response.status, 200));
  check("deterministic navigation skips text LLM", () => assert.equal(aiCalls, 1));
  check("deterministic navigation returns structured action", () => {
    assert.deepEqual(body.action, {
      type: "navigate",
      route: "/console/",
      section: "payments"
    });
  });
  check("deterministic navigation preserves transcript", () => {
    assert.equal(body.transcript, "Take me to payments");
  });
}

{
  const models = [];
  const response = await handleVoiceAssistant(audioRequest(), {
    AI: {
      async run(model) {
        models.push(model);
        if (model === TRANSCRIPTION_MODEL) {
          return { text: "What does revoked mean?" };
        }
        return { response: "REVOKED means an active Fact Lease can no longer maintain its issued verdict from the monitored evidence." };
      }
    },
    ASSISTANT_RATE_LIMITER: limiter()
  });
  const body = await response.json();

  check("product question uses transcription then routed default response model", () => {
    assert.deepEqual(models, [TRANSCRIPTION_MODEL, DEFAULT_ASSISTANT_RESPONSE_MODEL]);
  });
  check("product question returns text with no navigation action", () => {
    assert.equal(response.status, 200);
    assert.equal(body.action, null);
    assert.match(body.response, /REVOKED/);
  });
}

{
  const response = await handleVoiceAssistant(audioRequest(), {
    AI: {
      async run(model) {
        if (model === TRANSCRIPTION_MODEL) return { text: "do you?" };
        return { response: "" };
      }
    },
    ASSISTANT_RATE_LIMITER: limiter()
  });
  const body = await response.json();
  check("short ambiguous voice fragments never fall back to old ProofTTL capability list", () => {
    assert.equal(response.status, 200);
    assert.match(body.response, /What about me|Finish the thought/i);
    assert.doesNotMatch(body.response, /Fact Leases, the API, x402/i);
  });
}

{
  let aiCalls = 0;
  const response = await handleVoiceAssistant(audioRequest(), {
    AI: { async run() { aiCalls += 1; return { text: "hello" }; } },
    ASSISTANT_RATE_LIMITER: limiter(false)
  });

  check("rate limiting happens before AI inference", () => {
    assert.equal(response.status, 429);
    assert.equal(aiCalls, 0);
    assert.equal(response.headers.get("retry-after"), "60");
  });
}

{
  const response = await handleVoiceAssistant(audioRequest(), {
    AI: { async run() { return { text: "hello" }; } }
  });
  check("missing assistant limiter fails closed", () => assert.equal(response.status, 503));
}

{
  const response = await handleVoiceAssistant(
    audioRequest(new Uint8Array([1]), { "content-type": "application/json" }),
    {
      AI: { async run() { throw new Error("should not run"); } },
      ASSISTANT_RATE_LIMITER: limiter()
    }
  );
  check("non-audio request is rejected", () => assert.equal(response.status, 415));
}

{
  let aiCalls = 0;
  const response = await handleVoiceAssistant(
    audioRequest(new Uint8Array([1]), { "content-length": "600000" }),
    {
      AI: { async run() { aiCalls += 1; return { text: "hello" }; } },
      ASSISTANT_RATE_LIMITER: limiter()
    }
  );
  check("declared oversized audio is rejected before AI", () => {
    assert.equal(response.status, 413);
    assert.equal(aiCalls, 0);
  });
}

{
  const response = await handleVoiceAssistant(audioRequest(), {
    AI: { async run() { return { text: "   " }; } },
    ASSISTANT_RATE_LIMITER: limiter()
  });
  check("empty transcription asks user to retry", () => assert.equal(response.status, 422));
}

{
  const response = await handleVoiceAssistant(audioRequest(), {
    AI: { async run() { throw Object.assign(new Error("quota"), { name: "AiError" }); } },
    ASSISTANT_RATE_LIMITER: limiter()
  });
  const body = await response.json();
  check("AI quota/model failure degrades without paid fallback", () => {
    assert.equal(response.status, 503);
    assert.equal(body.error, "assistant_capacity_unavailable");
  });
}

console.log(`\n${checks} assistant checks passed.`);
