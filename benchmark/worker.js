import { normalizeAiUsage } from "../src/costs.js";
import { BENCHMARK_MODELS } from "./models.js";
import { SEMANTIC_FIXTURES } from "./semantic-fixtures.js";

const ALLOWED_LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!ALLOWED_LOCAL_HOSTS.has(url.hostname)) {
      return Response.json({ error: "local_only" }, { status: 404 });
    }

    if (request.method === "GET" && url.pathname === "/") {
      return Response.json({
        service: "ProofTTL semantic benchmark",
        local_only: true,
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
        run: "POST /run with JSON {\"model\":\"current70b|qwen3|llama8bFast\",\"limit\":14}"
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
      completionTokens,
      usageMissing
    );

    return Response.json({
      model_key: modelKey,
      model_id: model.id,
      json_schema_requested: model.jsonSchema,
      passed,
      total: cases.length,
      accuracy: cases.length ? passed / cases.length : 0,
      usage: {
        prompt_tokens: promptTokens,
        completion_tokens: completionTokens,
        cases_missing_usage: usageMissing
      },
      estimated_ai_cost_usd: estimatedCostUsd,
      pricing_checked_at: model.pricingCheckedAt,
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

  const options = {
    messages: [
      {
        role: "system",
        content: [
          "You are ProofTTL's conservative textual-entailment verifier.",
          "Use ONLY SOURCE TEXT; never use outside knowledge.",
          "Compare the exact factual proposition in CLAIM against SOURCE TEXT.",
          "SUPPORTED only if every material attribute in CLAIM matches the source: entity, value, number, unit, date/time, polarity, qualifier, direction, and scope.",
          "If the source states the same subject with a different value, return CONTRADICTED.",
          "UNKNOWN means missing, ambiguous, conditional, stale-looking, or insufficient.",
          "Evidence must be a short exact substring copied verbatim from SOURCE TEXT.",
          "Never label a claim SUPPORTED merely because the source discusses the same subject. Prefer UNKNOWN over guessing.",
          model.jsonSchema ? "Follow the supplied JSON schema." : "Return only a single JSON object with keys status, evidence, reason, and confidence. Do not include markdown."
        ].join(" ")
      },
      {
        role: "user",
        content: `CLAIM:\n${fixture.claim}\n\nSOURCE TEXT:\n${fixture.source}`
      }
    ],
    max_tokens: 300,
    temperature: 0
  };

  if (model.jsonSchema) {
    options.response_format = {
      type: "json_schema",
      json_schema: {
        name: "proofttl_benchmark_verdict",
        strict: true,
        schema
      }
    };
  }

  try {
    const raw = await ai.run(model.id, options);
    const usage = normalizeAiUsage(raw?.usage ?? raw?.result?.usage);
    const parsed = parseAiResult(raw);
    const guarded = applyProductionGuards(parsed, fixture.claim, fixture.source);
    const pass = guarded.status === fixture.expected;

    return {
      id: fixture.id,
      expected: fixture.expected,
      actual: guarded.status,
      pass,
      evidence: guarded.evidence,
      reason: guarded.reason,
      confidence: guarded.confidence,
      usage
    };
  } catch (error) {
    return {
      id: fixture.id,
      expected: fixture.expected,
      actual: "ERROR",
      pass: false,
      evidence: null,
      reason: error instanceof Error ? error.message : String(error),
      confidence: 0,
      usage: null
    };
  }
}

function applyProductionGuards(parsed, claim, sourceText) {
  if (!parsed || !["SUPPORTED", "CONTRADICTED", "UNKNOWN"].includes(parsed.status)) {
    return { status: "UNKNOWN", evidence: null, reason: "bad_ai_output", confidence: 0 };
  }

  let status = parsed.status;
  let evidence = typeof parsed.evidence === "string" ? parsed.evidence.trim() : null;
  let reason = String(parsed.reason || "");
  let confidence = clampNumber(parsed.confidence, 0, 1);

  if (evidence && !sourceText.includes(evidence)) {
    evidence = null;
    if (status !== "UNKNOWN") {
      status = "UNKNOWN";
      reason = "model_evidence_was_not_verbatim_in_source";
      confidence = Math.min(confidence, 0.25);
    }
  }

  if (status === "SUPPORTED" && !evidence) {
    status = "UNKNOWN";
    reason = "supported_verdict_without_verbatim_evidence";
    confidence = Math.min(confidence, 0.25);
  }

  if (status === "SUPPORTED" && evidence) {
    const mismatch = findCriticalLiteralMismatch(claim, evidence);
    if (mismatch) {
      status = "UNKNOWN";
      reason = `critical_claim_literal_missing_from_evidence:${mismatch}`;
      confidence = Math.min(confidence, 0.25);
    }
  }

  return { status, evidence, reason, confidence };
}

function parseAiResult(result) {
  if (!result) return null;
  if (typeof result === "object" && result.status) return result;
  const candidate = result.response ?? result.result ?? result.output_text ?? result;
  if (typeof candidate === "object") return candidate;
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

function findCriticalLiteralMismatch(claim, evidence) {
  const literals = extractCriticalLiterals(claim);
  const lowerEvidence = evidence.toLowerCase();
  return literals.find((literal) => !lowerEvidence.includes(literal.toLowerCase())) || null;
}

function extractCriticalLiterals(value) {
  const text = String(value);
  const literals = new Set();

  for (const match of text.matchAll(/(?:[$€£]\s*)?\d+(?:[.,]\d+)*(?:\s*%|\s*(?:ms|sec(?:ond)?s?|min(?:ute)?s?|hours?|days?|weeks?|months?|years?|kb|mb|gb|tb))?/gi)) {
    literals.add(match[0].replace(/\s+/g, " ").trim());
  }

  for (const match of text.matchAll(/\b[A-Z][A-Z0-9_-]{1,}\b/g)) {
    const token = match[0];
    if (!["HTTP", "HTTPS", "URL", "API"].includes(token)) literals.add(token);
  }

  for (const match of text.matchAll(/["“”']([^"“”']{2,80})["“”']/g)) {
    literals.add(match[1]);
  }

  return [...literals];
}

function estimateBenchmarkCost(model, promptTokens, completionTokens, usageMissing) {
  if (usageMissing > 0) return null;
  if (!Number.isFinite(model.inputUsdPerMillionTokens) || !Number.isFinite(model.outputUsdPerMillionTokens)) {
    return null;
  }
  const cost =
    (promptTokens * model.inputUsdPerMillionTokens +
      completionTokens * model.outputUsdPerMillionTokens) /
    1_000_000;
  return Math.round(cost * 1e12) / 1e12;
}

function clampNumber(value, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return min;
  return Math.max(min, Math.min(max, number));
}
