import {
  HYBRID_SEMANTIC_VERIFIER,
  LLAMA_70B_MODEL,
  QWEN3_MODEL,
  normalizeAiUsage
} from "./costs.js";

export const QWEN_PRIMARY_MAX_TOKENS = 900;
export const QWEN_LENGTH_RETRY_MAX_TOKENS = 2000;
export const LLAMA_FALLBACK_MAX_TOKENS = 300;

export function createHybridAiBinding(ai) {
  if (!ai || typeof ai.run !== "function") return ai;

  return {
    async run(model, input) {
      if (model !== HYBRID_SEMANTIC_VERIFIER) {
        return ai.run(model, input);
      }

      return runHybridSemantic(ai, input);
    }
  };
}

async function runHybridSemantic(ai, input) {
  const attempts = [];

  let primary = await invokeModel({
    ai,
    model: QWEN3_MODEL,
    input: qwenInput(input, QWEN_PRIMARY_MAX_TOKENS),
    attempts,
    successOutcome: "primary_verdict"
  });

  if (!primary.valid && primary.truncated) {
    primary = await invokeModel({
      ai,
      model: QWEN3_MODEL,
      input: qwenInput(input, QWEN_LENGTH_RETRY_MAX_TOKENS),
      attempts,
      successOutcome: "length_retry_verdict"
    });
  }

  if (primary.valid) {
    if (!supportedVerdictNeedsFallback(primary.parsed, input)) {
      return normalizedHybridResult(primary.parsed, attempts);
    }

    attempts[primary.attemptIndex].outcome = "supported_guard_failed";
  }

  const fallback = await invokeModel({
    ai,
    model: LLAMA_70B_MODEL,
    input: llamaFallbackInput(input),
    attempts,
    successOutcome: "fallback_verdict"
  });

  if (fallback.valid) {
    return normalizedHybridResult(fallback.parsed, attempts);
  }

  return normalizedHybridResult(
    {
      status: "UNKNOWN",
      evidence: null,
      reason: "semantic_verification_failed_after_qwen_and_70b",
      confidence: 0
    },
    attempts
  );
}

async function invokeModel({
  ai,
  model,
  input,
  attempts,
  successOutcome
}) {
  try {
    const raw = await ai.run(model, input);
    const usage = extractUsage(raw);
    const parsed = parseModelResponse(raw);
    const valid = isValidVerdict(parsed);
    const truncated = isLengthTruncated(raw);
    const attemptIndex = attempts.length;

    attempts.push({
      model,
      outcome: valid
        ? successOutcome
        : truncated
          ? "length_truncated"
          : "invalid_output",
      usage
    });

    return {
      raw,
      parsed,
      valid,
      truncated,
      attemptIndex
    };
  } catch {
    const attemptIndex = attempts.length;
    attempts.push({
      model,
      outcome: "error",
      usage: null
    });

    return {
      raw: null,
      parsed: null,
      valid: false,
      truncated: false,
      attemptIndex
    };
  }
}

function qwenInput(input, maxTokens) {
  const original = input && typeof input === "object" ? input : {};
  const { response_format: _responseFormat, ...rest } = original;
  const messages = Array.isArray(original.messages)
    ? original.messages.map((message) => ({ ...message }))
    : [];

  const instruction =
    "Return ONLY one JSON object with keys status, evidence, reason, confidence. No markdown.";
  const systemIndex = messages.findIndex(
    (message) => message?.role === "system" && typeof message?.content === "string"
  );

  if (systemIndex >= 0) {
    messages[systemIndex].content = `${messages[systemIndex].content} ${instruction}`;
  } else {
    messages.unshift({ role: "system", content: instruction });
  }

  return {
    ...rest,
    messages,
    max_tokens: maxTokens,
    temperature: 0
  };
}

function llamaFallbackInput(input) {
  const original = input && typeof input === "object" ? input : {};
  return {
    ...original,
    messages: Array.isArray(original.messages)
      ? original.messages.map((message) => ({ ...message }))
      : original.messages,
    max_tokens: LLAMA_FALLBACK_MAX_TOKENS,
    temperature: 0
  };
}

function normalizedHybridResult(verdict, attempts) {
  return {
    status: verdict.status,
    evidence:
      typeof verdict.evidence === "string"
        ? verdict.evidence.trim()
        : null,
    reason: String(verdict.reason || ""),
    confidence: clampNumber(verdict.confidence, 0, 1),
    usage: aggregateUsage(attempts)
  };
}

function aggregateUsage(attempts) {
  let promptTokens = 0;
  let completionTokens = 0;
  let totalTokens = 0;
  let hasPrompt = false;
  let hasCompletion = false;
  let hasTotal = false;

  for (const attempt of attempts) {
    const usage = attempt.usage;
    if (!usage) continue;

    if (Number.isFinite(Number(usage.prompt_tokens))) {
      promptTokens += Number(usage.prompt_tokens);
      hasPrompt = true;
    }
    if (Number.isFinite(Number(usage.completion_tokens))) {
      completionTokens += Number(usage.completion_tokens);
      hasCompletion = true;
    }
    if (Number.isFinite(Number(usage.total_tokens))) {
      totalTokens += Number(usage.total_tokens);
      hasTotal = true;
    }
  }

  return {
    ...(hasPrompt ? { prompt_tokens: promptTokens } : {}),
    ...(hasCompletion ? { completion_tokens: completionTokens } : {}),
    ...(hasTotal ? { total_tokens: totalTokens } : {}),
    ai_attempts: attempts.map((attempt) => ({
      model: attempt.model,
      outcome: attempt.outcome,
      usage: attempt.usage
    }))
  };
}

function extractUsage(result) {
  return normalizeAiUsage(
    result?.usage ??
    result?.result?.usage ??
    result?.choices?.[0]?.usage ??
    null
  );
}

function parseModelResponse(result) {
  if (!result) return null;
  if (typeof result === "object" && result.status) return result;

  const choiceContent =
    result?.choices?.[0]?.message?.content ??
    result?.result?.choices?.[0]?.message?.content;
  if (choiceContent !== undefined && choiceContent !== null) {
    return parseCandidate(choiceContent);
  }

  const candidate = result.response ?? result.result ?? result.output_text;
  if (candidate !== undefined && candidate !== result) {
    if (typeof candidate === "object" && candidate?.status) return candidate;
    if (typeof candidate === "string") return parseCandidate(candidate);
  }

  return null;
}

function parseCandidate(candidate) {
  if (typeof candidate === "object" && candidate?.status) return candidate;
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

function isValidVerdict(parsed) {
  return Boolean(
    parsed &&
    ["SUPPORTED", "CONTRADICTED", "UNKNOWN"].includes(parsed.status)
  );
}

function isLengthTruncated(result) {
  const finishReason =
    result?.choices?.[0]?.finish_reason ??
    result?.result?.choices?.[0]?.finish_reason ??
    result?.finish_reason ??
    null;
  return String(finishReason || "").toLowerCase() === "length";
}

function supportedVerdictNeedsFallback(verdict, input) {
  if (verdict.status !== "SUPPORTED") return false;

  const evidence =
    typeof verdict.evidence === "string"
      ? verdict.evidence.trim()
      : "";
  const { claim, sourceText } = promptContext(input);

  if (!claim || !sourceText || !evidence) return true;
  if (!sourceText.includes(evidence)) return true;

  return Boolean(findCriticalLiteralMismatch(claim, evidence));
}

function promptContext(input) {
  const messages = Array.isArray(input?.messages) ? input.messages : [];
  const userMessage = [...messages]
    .reverse()
    .find(
      (message) =>
        message?.role === "user" && typeof message?.content === "string"
    );
  const text = userMessage?.content || "";

  const claimMarker = "CLAIM:\n";
  const sourceUrlMarker = "\n\nSOURCE URL:\n";
  const sourceMarker = "\n\nSOURCE TEXT:\n";
  const claimStart = text.indexOf(claimMarker);
  const sourceStart = text.indexOf(sourceMarker);

  if (claimStart === -1 || sourceStart === -1) {
    return { claim: "", sourceText: "" };
  }

  const claimValueStart = claimStart + claimMarker.length;
  const sourceUrlStart = text.indexOf(sourceUrlMarker, claimValueStart);
  const claimEnd =
    sourceUrlStart !== -1 && sourceUrlStart < sourceStart
      ? sourceUrlStart
      : sourceStart;

  return {
    claim: text.slice(claimValueStart, claimEnd).trim(),
    sourceText: text.slice(sourceStart + sourceMarker.length)
  };
}

function findCriticalLiteralMismatch(claim, evidence) {
  const literals = extractCriticalLiterals(claim);
  if (literals.length === 0) return null;

  const lowerEvidence = evidence.toLowerCase();
  for (const literal of literals) {
    if (!lowerEvidence.includes(literal.toLowerCase())) return literal;
  }
  return null;
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

function clampNumber(value, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return min;
  return Math.max(min, Math.min(max, number));
}
