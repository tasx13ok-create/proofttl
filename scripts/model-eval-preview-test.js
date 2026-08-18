import benchmarkWorker from "../benchmark/worker.js";

let passed = 0;

function assert(condition, message) {
  if (!condition) throw new Error(message);
  passed += 1;
  console.log(`PASS ${passed}: ${message}`);
}

async function run() {
  console.log("ProofTTL benchmark preview readiness regression test\n");

  const env = {
    BENCHMARK_TOKEN: "test-benchmark-token-1234567890",
    AI: {
      async run() {
        throw new Error("AI should not be called by readiness/auth regression test");
      }
    }
  };

  const ready = await benchmarkWorker.fetch(
    new Request("https://preview.example/"),
    env
  );
  const readyBody = await ready.json();
  assert(ready.status === 200, "readiness endpoint is reachable without benchmark authentication");
  assert(readyBody.preview_ready === true, "readiness endpoint explicitly reports preview_ready=true");

  const noToken = await benchmarkWorker.fetch(
    new Request("https://preview.example/run", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: "current70b", limit: 1 })
    }),
    env
  );
  assert(noToken.status === 404, "benchmark run remains hidden without the one-run token");

  const wrongToken = await benchmarkWorker.fetch(
    new Request("https://preview.example/run", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-proofttl-benchmark-token": "wrong-token"
      },
      body: JSON.stringify({ model: "current70b", limit: 1 })
    }),
    env
  );
  assert(wrongToken.status === 404, "benchmark run rejects an incorrect one-run token");

  const authenticated = await benchmarkWorker.fetch(
    new Request("https://preview.example/run", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-proofttl-benchmark-token": env.BENCHMARK_TOKEN
      },
      body: JSON.stringify({ model: "does-not-exist", limit: 1 })
    }),
    env
  );
  assert(authenticated.status === 400, "authenticated benchmark request reaches normal request validation");

  console.log(`\nSUCCESS: ${passed} ProofTTL benchmark preview checks passed.`);
}

run().catch((error) => {
  console.error("\nBENCHMARK PREVIEW TEST FAILED:", error.stack || error.message);
  process.exitCode = 1;
});
