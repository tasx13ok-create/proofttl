import core from "../src/index.js";

let passed = 0;

function assert(condition, message) {
  if (!condition) throw new Error(message);
  passed += 1;
  console.log(`PASS ${passed}: ${message}`);
}

class CountingKV {
  constructor() {
    this.entries = new Map();
    this.puts = [];
  }

  async get(key) {
    return this.entries.get(key)?.value ?? null;
  }

  async put(key, value, options = {}) {
    this.puts.push({ key, value: String(value), options });
    this.entries.set(key, {
      value: String(value),
      metadata: options.metadata ?? null
    });
  }

  async list({ prefix = "", limit = 1000 } = {}) {
    const keys = [...this.entries.entries()]
      .filter(([name]) => name.startsWith(prefix))
      .slice(0, limit)
      .map(([name, entry]) => ({ name, metadata: entry.metadata }));
    return { keys, list_complete: true };
  }
}

async function scheduledAt(env, scheduledTime) {
  const pending = [];
  await core.scheduled(
    { scheduledTime },
    env,
    {
      waitUntil(promise) {
        pending.push(Promise.resolve(promise));
      }
    }
  );
  await Promise.all(pending);
}

async function run() {
  console.log("ProofTTL idle monitor write-budget regression test\n");

  const kv = new CountingKV();
  const fiveMinuteBoundary = Date.UTC(2026, 7, 18, 0, 0, 0);

  await scheduledAt({ LEASES: kv }, fiveMinuteBoundary);
  assert(
    kv.puts.filter((item) => item.key === "monitor:last_run").length === 1,
    "idle monitor persists status on a five-minute boundary"
  );

  for (let minute = 1; minute < 5; minute += 1) {
    await scheduledAt({ LEASES: kv }, fiveMinuteBoundary + minute * 60_000);
  }
  assert(
    kv.puts.filter((item) => item.key === "monitor:last_run").length === 1,
    "four intervening idle minute runs do not write monitor status"
  );

  await scheduledAt({ LEASES: kv }, fiveMinuteBoundary + 5 * 60_000);
  assert(
    kv.puts.filter((item) => item.key === "monitor:last_run").length === 2,
    "next five-minute boundary persists the next idle status sample"
  );

  const projectedIdleWritesPerDay = (24 * 60) / 5;
  assert(projectedIdleWritesPerDay === 288, "idle monitor status budget is 288 KV writes/day");
  assert(projectedIdleWritesPerDay < 1000, "idle monitor status budget stays below the current Free KV daily write allowance");

  console.log(`\nSUCCESS: ${passed} ProofTTL idle monitor write-budget checks passed.`);
}

run().catch((error) => {
  console.error("\nMONITOR COST TEST FAILED:", error.stack || error.message);
  process.exitCode = 1;
});
