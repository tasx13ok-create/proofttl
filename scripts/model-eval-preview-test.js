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
    AI: {
      async run() {
        throw new Error("AI should not be called by readiness/request validation regression test");
      }
    }
  };

  const ready = await benchmarkWorker.fetch(
    new Request("https://preview.example/"),
    env
  );
  const readyBody = await ready.json();
  assert(ready.status === 200, "readiness endpoint is reachable inside the preview session");
  assert(readyBody.preview_ready === true, "readiness endpoint explicitly reports preview_ready=true");

  const wrongMethod = await benchmarkWorker.fetch(
    new Request("https://preview.example/run"),
    env
  );
  assert(wrongMethod.status === 404, "benchmark run only accepts POST requests");

  const invalidJson = await benchmarkWorker.fetch(
    new Request("https://preview.example/run", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "not-json"
    }),
    env
  );
  assert(invalidJson.status === 400, "benchmark run rejects invalid JSON before AI invocation");

  const unknownModel = await benchmarkWorker.fetch(
    new Request("https://preview.example/run", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: "does-not-exist", limit: 1 })
    }),
    env
  );
  const unknownBody = await unknownModel.json();
  assert(unknownModel.status === 400, "benchmark request reaches normal model validation");
  assert(Array.isArray(unknownBody.allowed) && unknownBody.allowed.includes("current70b"), "unknown-model response advertises the benchmark model catalog");

  console.log(`\nSUCCESS: ${passed} ProofTTL benchmark preview checks passed.`);
}

run().catch((error) => {
  console.error("\nBENCHMARK PREVIEW TEST FAILED:", error.stack || error.message);
  process.exitCode = 1;
});
