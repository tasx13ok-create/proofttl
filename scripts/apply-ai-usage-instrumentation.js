import fs from "node:fs";

const path = "src/index.js";
let source = fs.readFileSync(path, "utf8");
const eol = source.includes("\r\n") ? "\r\n" : "\n";

function replaceOnce(label, search, replacement) {
  const normalizedSearch = search.replaceAll("\n", eol);
  const normalizedReplacement = replacement.replaceAll("\n", eol);
  const at = source.indexOf(normalizedSearch);
  if (at === -1) throw new Error(`Patch anchor not found: ${label}`);
  if (source.indexOf(normalizedSearch, at + normalizedSearch.length) !== -1) {
    throw new Error(`Patch anchor is not unique: ${label}`);
  }
  source = source.slice(0, at) + normalizedReplacement + source.slice(at + normalizedSearch.length);
}

replaceOnce(
  "lease ai usage",
  '    proof_basis: verdict.verifier === "deterministic-exact-match" ? "EXACT_TEXT" : "SEMANTIC",\n    lease_state: "ACTIVE",',
  '    proof_basis: verdict.verifier === "deterministic-exact-match" ? "EXACT_TEXT" : "SEMANTIC",\n    ai_usage: verdict.ai_usage || null,\n    lease_state: "ACTIVE",'
);

replaceOnce(
  "reverify check ai usage",
  '    verifier: currentVerdict.verifier,\n    source_fingerprint: currentFingerprint,',
  '    verifier: currentVerdict.verifier,\n    ai_usage: currentVerdict.ai_usage || null,\n    source_fingerprint: currentFingerprint,'
);

replaceOnce(
  "issued check ai usage",
  '    verifier: verdict.verifier,\n    source_fingerprint: fingerprint,',
  '    verifier: verdict.verifier,\n    ai_usage: verdict.ai_usage || null,\n    source_fingerprint: fingerprint,'
);

replaceOnce(
  "capture ai usage",
  '    const parsed = parseAiResult(result);',
  '    const aiUsage = normalizeAiUsage(result?.usage ?? result?.result?.usage);\n    const parsed = parseAiResult(result);'
);

replaceOnce(
  "semantic verdict ai usage",
  '      confidence: clampNumber(parsed.confidence, 0, 1),\n      verifier: MODEL\n    };',
  '      confidence: clampNumber(parsed.confidence, 0, 1),\n      verifier: MODEL,\n      ai_usage: aiUsage\n    };'
);

replaceOnce(
  "semantic failure ai usage",
  '      confidence: 0,\n      verifier: MODEL\n    };\n  }\n}\n\nfunction deterministicCheck',
  '      confidence: 0,\n      verifier: MODEL,\n      ai_usage: null\n    };\n  }\n}\n\nfunction deterministicCheck'
);

replaceOnce(
  "usage normalizer",
  'function clampInt(value, min, max) {',
  `function normalizeAiUsage(usage) {\n  if (!usage || typeof usage !== "object") return null;\n\n  const promptTokens = Number(usage.prompt_tokens);\n  const completionTokens = Number(usage.completion_tokens);\n  const totalTokens = Number(usage.total_tokens);\n\n  const normalized = {};\n  if (Number.isFinite(promptTokens) && promptTokens >= 0) normalized.prompt_tokens = promptTokens;\n  if (Number.isFinite(completionTokens) && completionTokens >= 0) normalized.completion_tokens = completionTokens;\n  if (Number.isFinite(totalTokens) && totalTokens >= 0) normalized.total_tokens = totalTokens;\n\n  return Object.keys(normalized).length > 0 ? normalized : null;\n}\n\nfunction clampInt(value, min, max) {`
);

fs.writeFileSync(path, source, "utf8");
console.log("Applied Workers AI usage instrumentation to src/index.js");
