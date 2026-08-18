import {
  HYBRID_SEMANTIC_VERIFIER,
  LLAMA_70B_MODEL,
  QWEN3_MODEL
} from "../src/costs.js";
import {
  LLAMA_FALLBACK_MAX_TOKENS,
  QWEN_LENGTH_RETRY_MAX_TOKENS,
  QWEN_PRIMARY_MAX_TOKENS,
  createHybridAiBinding
} from "../src/ai-router.js";

let passed = 0;

function assert(condition, message) {
  if (!condition) throw new Error(message);
  passed += 1;
  console.log(`PASS ${passed}: ${message}`);
}

const baseInput = {
  messages: [
    {
      role: "system",
      content: "You are ProofTTL's conservative textual-entailment verifier."
    },
    {
      role: "user",
      content: [
        "CLAIM:",
        "Feature Orion is enabled.",
        "",
        "SOURCE URL:",
        "https://example.com/source",
        "",
        "SOURCE TEXT:",
        "Current feature flags show Orion with status ON for production accounts."
      ].join("\n")
    }
  ],
  response_format: {
    type: "json_schema",
    json_schema: { name: "proofttl_verdict", schema: { type: "object" } }
  },
  max_tokens: 300,
  temperature: 0
};

function verdict(status, evidence, reason = "fixture", confidence = 0.95, usage = null) {
  return {
    response: JSON.stringify({ status, evidence, reason, confidence }),
    ...(usage ? { usage } : {})
  };
}

async function run() {
  console.log("ProofTTL hybrid semantic model routing regression test\n");

  assert(QWEN_PRIMARY_MAX_TOKENS === 900, "Qwen primary budget is 900 tokens");
  assert(QWEN_LENGTH_RETRY_MAX_TOKENS === 2000, "Qwen length retry budget is 2000 tokens");
  assert(LLAMA_FALLBACK_MAX_TOKENS === 300, "70B fallback keeps the 300-token schema budget");

  {
    const calls = [];
    const binding = createHybridAiBinding({
      async run(model, input) {
        calls.push({ model, input });
        return verdict(
          "SUPPORTED",
          "Orion with status ON",
          "source supports the claim",
          0.97,
          { prompt_tokens: 120, completion_tokens: 80 }
        );
      }
    });

    const result = await binding.run(HYBRID_SEMANTIC_VERIFIER, baseInput);
    assert(result.status === "SUPPORTED", "safe Qwen primary verdict is returned");
    assert(calls.length === 1 && calls[0].model === QWEN3_MODEL, "safe primary verdict uses Qwen only");
    assert(calls[0].input.max_tokens === 900, "Qwen primary receives the measured token budget");
    assert(calls[0].input.response_format === undefined, "Qwen primary does not claim JSON-schema mode");
    assert(result.usage.ai_attempts.length === 1, "primary-only result reports one priced AI attempt");
  }

  {
    const calls = [];
    const binding = createHybridAiBinding({
      async run(model, input) {
        calls.push({ model, input });
        if (calls.length === 1) {
          return {
            choices: [
              {
                finish_reason: "length",
                message: { content: null, reasoning: "truncated reasoning fixture" }
              }
            ],
            usage: { prompt_tokens: 120, completion_tokens: 900 }
          };
        }
        return verdict(
          "SUPPORTED",
          "Orion with status ON",
          "retry completed",
          0.96,
          { prompt_tokens: 120, completion_tokens: 300 }
        );
      }
    });

    const result = await binding.run(HYBRID_SEMANTIC_VERIFIER, baseInput);
    assert(result.status === "SUPPORTED", "length-truncated Qwen call can recover on one retry");
    assert(calls.length === 2 && calls.every((call) => call.model === QWEN3_MODEL), "length retry stays on Qwen and does not invoke 70B");
    assert(calls[1].input.max_tokens === 2000, "length retry receives the larger Qwen budget");
    assert(result.usage.ai_attempts.length === 2, "retry result preserves both Qwen attempts for cost accounting");
    assert(result.usage.ai_attempts[0].outcome === "length_truncated", "first truncated attempt is labeled explicitly");
  }

  {
    const calls = [];
    const binding = createHybridAiBinding({
      async run(model, input) {
        calls.push({ model, input });
        if (model === QWEN3_MODEL) {
          return {
            response: "not valid JSON",
            usage: { prompt_tokens: 100, completion_tokens: 40 }
          };
        }
        return verdict(
          "CONTRADICTED",
          "Orion with status ON",
          "fallback fixture",
          0.9,
          { prompt_tokens: 100, completion_tokens: 30 }
        );
      }
    });

    const result = await binding.run(HYBRID_SEMANTIC_VERIFIER, baseInput);
    assert(result.status === "CONTRADICTED", "invalid Qwen output falls back to a 70B verdict");
    assert(calls.map((call) => call.model).join(",") === `${QWEN3_MODEL},${LLAMA_70B_MODEL}`, "technical fallback order is Qwen then 70B");
    assert(calls[1].input.response_format?.type === "json_schema", "70B fallback retains JSON-schema mode");
    assert(calls[1].input.max_tokens === 300, "70B fallback uses the bounded schema budget");
    assert(result.usage.ai_attempts.length === 2, "fallback result preserves both model attempts");
  }

  {
    const calls = [];
    const binding = createHybridAiBinding({
      async run(model, input) {
        calls.push({ model, input });
        if (model === QWEN3_MODEL) {
          return verdict(
            "SUPPORTED",
            "evidence that is not in the source",
            "unsafe supported fixture",
            0.99,
            { prompt_tokens: 100, completion_tokens: 50 }
          );
        }
        return verdict(
          "UNKNOWN",
          null,
          "fallback refuses unsupported evidence",
          0.7,
          { prompt_tokens: 100, completion_tokens: 25 }
        );
      }
    });

    const result = await binding.run(HYBRID_SEMANTIC_VERIFIER, baseInput);
    assert(result.status === "UNKNOWN", "unsafe Qwen SUPPORTED verdict is not trusted directly");
    assert(calls.length === 2 && calls[1].model === LLAMA_70B_MODEL, "failed SUPPORTED evidence guard triggers 70B fallback");
    assert(result.usage.ai_attempts[0].outcome === "supported_guard_failed", "unsafe Qwen SUPPORTED attempt is labeled for telemetry");
  }

  {
    const calls = [];
    const binding = createHybridAiBinding({
      async run(model, input) {
        calls.push({ model, input });
        return verdict(
          "UNKNOWN",
          null,
          "source is insufficient",
          0.6,
          { prompt_tokens: 100, completion_tokens: 35 }
        );
      }
    });

    const result = await binding.run(HYBRID_SEMANTIC_VERIFIER, baseInput);
    assert(result.status === "UNKNOWN", "ordinary Qwen UNKNOWN is accepted conservatively");
    assert(calls.length === 1 && calls[0].model === QWEN3_MODEL, "ordinary UNKNOWN does not waste a 70B fallback call");
  }

  {
    const calls = [];
    const binding = createHybridAiBinding({
      async run(model, input) {
        calls.push({ model, input });
        return { response: "passthrough" };
      }
    });

    await binding.run(LLAMA_70B_MODEL, { prompt: "direct" });
    assert(calls.length === 1 && calls[0].model === LLAMA_70B_MODEL, "non-pipeline AI calls pass through unchanged");
  }

  console.log(`\nSUCCESS: ${passed} ProofTTL hybrid model routing checks passed.`);
}

run().catch((error) => {
  console.error("\nMODEL ROUTING TEST FAILED:", error.stack || error.message);
  process.exitCode = 1;
});
