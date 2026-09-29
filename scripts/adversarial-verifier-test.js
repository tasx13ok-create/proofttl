import core from "../src/index.js";

let passed = 0;

function assert(condition, message) {
  if (!condition) throw new Error(message);
  passed += 1;
  console.log(`PASS ${passed}: ${message}`);
}

async function withMockFetch(sourceText, fn) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(sourceText, {
      status: 200,
      headers: { "content-type": "text/plain; charset=utf-8" }
    });

  try {
    return await fn();
  } finally {
    globalThis.fetch = originalFetch;
  }
}

async function verifyAgainst(sourceText, claim = "Feature Orion is enabled.") {
  return withMockFetch(sourceText, async () => {
    const response = await core.fetch(
      new Request("https://proofttl.test/verify", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          claim,
          source_url: "https://8.8.8.8/source",
          ttl_seconds: 300
        })
      }),
      {}
    );

    assert(response.status === 200, "verification request returns HTTP 200");
    return response.json();
  });
}

async function run() {
  console.log("ProofTTL adversarial verifier regression test\n");

  const clean = await verifyAgainst(
    "Production status: Feature Orion is enabled. Availability is monitored continuously."
  );
  assert(clean.status === "SUPPORTED", "plain assertive exact evidence may use deterministic fast path");
  assert(
    clean.verifier === "deterministic-exact-match",
    "clean exact evidence is still handled without model inference"
  );

  const quotedRefutation = await verifyAgainst(
    'Documentation correction: "Feature Orion is enabled." is false. Orion is disabled in production.'
  );
  assert(
    quotedRefutation.status !== "SUPPORTED",
    "quoted false statement cannot become SUPPORTED merely because the claim text appears verbatim"
  );

  const attributedRumor = await verifyAgainst(
    "A rumor claims Feature Orion is enabled. Official production status lists Orion as disabled."
  );
  assert(
    attributedRumor.status !== "SUPPORTED",
    "attributed rumor cannot become deterministic support"
  );

  const stalePolicy = await verifyAgainst(
    "Archived policy: Feature Orion is enabled. This was superseded; Orion is no longer enabled."
  );
  assert(
    stalePolicy.status !== "SUPPORTED",
    "superseded exact text cannot become deterministic support"
  );

  const hypothetical = await verifyAgainst(
    "Hypothetical example: Feature Orion is enabled. This example is not a statement of production state."
  );
  assert(
    hypothetical.status !== "SUPPORTED",
    "hypothetical exact text cannot become deterministic support"
  );

  const qualifiedConflict = await verifyAgainst(
    "Feature Orion is enabled. However, that statement applies only to the retired beta environment."
  );
  assert(
    qualifiedConflict.status !== "SUPPORTED",
    "nearby qualification forces semantic review instead of exact-match support"
  );

  console.log(`\nSUCCESS: ${passed} adversarial verifier checks passed.`);
}

run().catch((error) => {
  console.error("\nADVERSARIAL VERIFIER TEST FAILED:", error.stack || error.message);
  process.exitCode = 1;
});
