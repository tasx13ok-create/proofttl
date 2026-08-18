import { normalizeAiUsage } from "../src/costs.js";
import { BENCHMARK_MODELS } from "./models.js";
import { SEMANTIC_FIXTURES } from "./semantic-fixtures.js";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // Readiness is intentionally side-effect free. The benchmark itself only
    // exists inside Wrangler's temporary remote-preview session and is never
    // deployed to workers.dev.
    if (request.method === "GET" && url.pathname === "/") {
      return Response.json({
        service: "ProofTTL semantic benchmark",
        preview_ready: true,
        models: Object.fromEntries(
          Object.entries(BENCHMARK_MODELS).map(([key, model]) => [
            key,
            {
              id: model.id,
              json_schema: model.jsonSchema,
              pricing_known: Number.isFinite(model.inputUsdPerMillionTokens) && Number.isFinite(model.outputUsdPerMillionTokens),
              note: model.note
            }
          ])
        ),
        fixture_count: SEMANTIC_FIXTURES.length,
        run: "POST /run inside the active Wrangler remote-preview session"
      });
    }

    if (request.method !== "POST" || url.pathname !== "/run") {
      return Response.json({ error: "not_found" }, { status: 404 });
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return Response.json({ error: "invalid_json" }, { status: 400 });
    }

    const modelKey = String(body?.model || "");
    const model = BENCHMARK_MODELS[modelKey];
    if (!model) {
      return Response.json(
        { error: "unknown_model", allowed: Object.keys(BENCHMARK_MODELS) },
        { status: 400 }
      );
    }

    const limit = Math.max(
      1,
      Math.min(SEMANTIC_FIXTURES.length, Number.parseInt(body?.limit ?? SEMANTIC_FIXTURES.length, 10) || SEMANTIC_FIXTURES.length)
    );

    const cases = [];
    let passed = 0;
    let promptTokens = 0;
    let completionTokens = 0;
    let usageMissing = 0;
    const startedAt = Date.now();

    for (const fixture of SEMANTIC_FIXTURES.slice(0, limit)) {
      const result = await runFixture(env.AI, model, fixture);
      cases.push(result);
      if (result.pass) passed += 1;
      if (result.usage) {
        promptTokens += result.usage.prompt_tokens || 0;
        completionTokens += result.usage.completion_tokens || 0;
      } else {
        usageMissing += 1;
      }
    }

    const estimatedCostUsd = estimateBenchmarkCost(
      model,
      promptTokens,
      completionTokens
    );

    return Response.json({
      model_key: modelKey,
      model_id: model.id,
      total: cases.length,
      passed,
      accuracy: cases.length ? passed / cases.length : 0,
      usage: {
        prompt_tokens: promptTokens,
        completion_tokens: completionTokens,
        cases_missing_usage: usageMissing
      },
      estimated_ai_cost_usd: estimatedCostUsd,
      elapsed_ms: Date.now() - startedAt,
      cases
    });
  }
};

async function runFixture(ai, model, fixture) {
  const schema = {
    type: "object",
    properties: {
      status: { type: "string", enum: ["SUPPORTED", "CONTRADICTED", "UNKNOWN"] },
      evidence: { type: ["string", "null"] },
      reason: { type: "string" },
      confidence: { type: "number", minimum: 0, maximum: 1 }
    },
    required: ["status", "evidence", "reason", "confidence"],
    additionalProperties: false
  };

  const system = [
    "You are ProofTTL's conservative textual-entailment verifier.",
    "Use ONLY SOURCE TEXT; never use outside knowledge.",
    "Compare the exact factual proposition in CLAIM against SOURCE TEXT.",
    "SUPPORTED only if every material attribute in CLAIM matches the source: entity, value, number, unit, date/time, polarity, qualifier, direction, and scope.",
    "If the source states the same subject with a different value, return CONTRADICTED.",
    "UNKNOWN means missing, ambiguous, conditional, stale-looking, or insufficient.",
    "Evidence must be a short exact substring copied verbatim from SOURCE TEXT.",
    "Never label a claim SUPPORTED merely because the source discusses the same subject. Prefer UNKNOWN over guessing."
  ].join(" ");

  const user = `CLAIM:\n${fixture.claim}\n\nSOURCE TEXT:\n${fixture.source}`;

  try {
    const aiRequest = {
      messages: [
        { role: "system", content: system },
        { role: "user", content: user }
      ],
      max_tokens: 300,
      temperature: 0
    };

    if (model.jsonSchema) {
      aiRequest.response_format = {
        type: "json_schema",
        json_schema: {
          name: "proofttl_benchmark_verdict",
          strict: true,
          schema
        }
      };
    } else {
      aiRequest.messages[0].content += " Return ONLY one JSON object with keys status, evidence, reason, confidence. No markdown.";
    }

    const raw = await ai.run(model.id, aiRequest);
    const usage = normalizeAiUsage(raw?.usage ?? raw?.result?.usage);
    const parsed = parseModelResponse(raw);

    if (!parsed || !["SUPPORTED", "CONTRADICTED", "UNKNOWN"].includes(parsed.status)) {
      return failure(fixture, "ERROR", "invalid_model_output", usage);
    }

    const evidence = typeof parsed.evidence === "string" ? parsed.evidence.trim() : null;
    if (evidence && !fixture.source.includes(evidence)) {
      return failure(fixture, "ERROR", "non_verbatim_evidence", usage);
    }

    const actual = parsed.status;
    return {
      id: fixture.id,
      expected: fixture.expected,
      actual,
      pass: actual === fixture.expected,
      evidence,
      reason: String(parsed.reason || ""),
      confidence: Number(parsed.confidence) || 0,
      usage
    };
  } catch (error) {
    return failure(
      fixture,
      "ERROR",
      error instanceof Error ? error.message : String(error),
      null
    );
  }
}

function failure(fixture, actual, reason, usage) {
  return {
    id: fixture.id,
    expected: fixture.expected,
    actual,
    pass: false,
    evidence: null,
    reason,
    confidence: 0,
    usage
  };
}

function parseModelResponse(result) {
  if (!result) return null;
  if (typeof result === "object" && result.status) return result;
  const candidate = result.response ?? result.result ?? result.output_text ?? result;
  if (typeof candidate === "object" && candidate.status) return candidate;
  if (typeof candidate !== "string") return null;

  try {
    return JSON.parse(candidate);
  } catch {
    const match = candidate.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      return JSON.parse(match[0]);
    } catch {
      return null;
    }
  }
}

function estimateBenchmarkCost(model, promptTokens, completionTokens) {
  const inputRate = Number(model.inputUsdPerMillionTokens);
  const outputRate = Number(model.outputUsdPerMillionTokens);
  if (!Number.isFinite(inputRate) || !Number.isFinite(outputRate)) return null;

  return (
    promptTokens * inputRate + completionTokens * outputRate
  ) / 1_000_000;
}
