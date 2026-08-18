import { SEMANTIC_MODEL } from "../src/costs.js";
import { BENCHMARK_MODELS } from "../benchmark/models.js";
import { SEMANTIC_FIXTURES } from "../benchmark/semantic-fixtures.js";

let passed = 0;

function assert(condition, message) {
  if (!condition) throw new Error(message);
  passed += 1;
  console.log(`PASS ${passed}: ${message}`);
}

async function run() {
  console.log("ProofTTL semantic benchmark fixture validation\n");

  assert(SEMANTIC_FIXTURES.length >= 30, "benchmark has at least 30 semantic fixtures");
  assert(BENCHMARK_MODELS.current70b.id === SEMANTIC_MODEL, "benchmark current70b matches the production semantic model");
  assert(BENCHMARK_MODELS.current70b.jsonSchema === true, "current model benchmark uses JSON schema mode");
  assert(BENCHMARK_MODELS.qwen3.jsonSchema === false, "Qwen3 benchmark does not claim undocumented JSON schema support");
  assert(BENCHMARK_MODELS.qwen3.inputUsdPerMillionTokens < BENCHMARK_MODELS.current70b.inputUsdPerMillionTokens, "Qwen3 candidate input pricing is lower than current 70B pricing");
  assert(BENCHMARK_MODELS.qwen3.outputUsdPerMillionTokens < BENCHMARK_MODELS.current70b.outputUsdPerMillionTokens, "Qwen3 candidate output pricing is lower than current 70B pricing");

  const ids = new Set();
  const statusCounts = {
    SUPPORTED: 0,
    CONTRADICTED: 0,
    UNKNOWN: 0
  };

  for (const fixture of SEMANTIC_FIXTURES) {
    assert(!ids.has(fixture.id), `fixture id is unique: ${fixture.id}`);
    ids.add(fixture.id);
    assert(typeof fixture.claim === "string" && fixture.claim.length >= 12, `fixture has a substantive claim: ${fixture.id}`);
    assert(typeof fixture.source === "string" && fixture.source.length >= 20, `fixture has substantive source text: ${fixture.id}`);
    assert(["SUPPORTED", "CONTRADICTED", "UNKNOWN"].includes(fixture.expected), `fixture expected status is valid: ${fixture.id}`);
    assert(!fixture.source.toLowerCase().includes(fixture.claim.toLowerCase()), `fixture forces semantic rather than exact-match verification: ${fixture.id}`);
    statusCounts[fixture.expected] += 1;
  }

  assert(statusCounts.SUPPORTED >= 8, "benchmark includes at least 8 SUPPORTED cases");
  assert(statusCounts.CONTRADICTED >= 8, "benchmark includes at least 8 CONTRADICTED cases");
  assert(statusCounts.UNKNOWN >= 8, "benchmark includes at least 8 UNKNOWN cases");

  console.log(`\nCoverage: ${SEMANTIC_FIXTURES.length} fixtures (${statusCounts.SUPPORTED} SUPPORTED, ${statusCounts.CONTRADICTED} CONTRADICTED, ${statusCounts.UNKNOWN} UNKNOWN)`);
  console.log(`SUCCESS: ${passed} ProofTTL semantic benchmark fixture checks passed.`);
}

run().catch((error) => {
  console.error("\nMODEL EVAL FIXTURE TEST FAILED:", error.stack || error.message);
  process.exitCode = 1;
});
