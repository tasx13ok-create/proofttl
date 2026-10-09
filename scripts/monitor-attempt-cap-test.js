import core from "../src/index.js";

let passed = 0;
function assert(condition, message) {
  if (!condition) throw new Error(message);
  passed += 1;
  console.log(`PASS ${passed}: ${message}`);
}

class FailingSaveKV {
  constructor(entries) {
    this.entries = new Map(entries.map(([name, value, metadata]) => [name, { value, metadata }]));
    this.monitorSummary = null;
  }

  async get(key) {
    return this.entries.get(key)?.value ?? null;
  }

  async list({ prefix = "", limit = 1000 } = {}) {
    const keys = [...this.entries.entries()]
      .filter(([name]) => name.startsWith(prefix))
      .slice(0, limit)
      .map(([name, entry]) => ({ name, metadata: entry.metadata }));
    return { keys, list_complete: true };
  }

  async put(key, value) {
    if (key === "monitor:last_run") {
      this.monitorSummary = String(value);
      return;
    }
    throw new Error("simulated_persistence_failure");
  }
}

function dueLease(id, now) {
  const issued = new Date(now - 60_000).toISOString();
  const expires = new Date(now + 600_000).toISOString();
  const next = new Date(now - 1_000).toISOString();
  const lease = {
    lease_id: id,
    protocol: "ProofTTL/0.3.1",
    claim: "status color is BLUE",
    status: "SUPPORTED",
    source_url: "https://8.8.8.8/source",
    final_url: "https://8.8.8.8/source",
    evidence: "status color is BLUE",
    reason: "exact_claim_text_found_in_source",
    issued_at: issued,
    observed_at: issued,
    expires_at: expires,
    ttl_seconds: 600,
    source_fingerprint: "sha256:old",
    last_source_fingerprint: "sha256:old",
    confidence: 0.99,
    verifier: "deterministic-exact-match",
    proof_basis: "EXACT_TEXT",
    lease_state: "ACTIVE",
    verification_count: 1,
    last_checked_at: issued,
    history: [],
    monitor_interval_seconds: 100,
    next_check_at: next
  };
  return [
    `lease:${id}`,
    JSON.stringify(lease),
    { lease_state: "ACTIVE", expires_at: expires, next_check_at: next }
  ];
}

async function runScheduled(env, scheduledTime) {
  const pending = [];
  await core.scheduled(
    { scheduledTime },
    env,
    { waitUntil(promise) { pending.push(Promise.resolve(promise)); } }
  );
  await Promise.all(pending);
}

async function run() {
  const now = Date.now();
  const kv = new FailingSaveKV(
    Array.from({ length: 25 }, (_, index) => dueLease(`ftl_attempt_cap_${index}`, now))
  );

  let fetchCalls = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    fetchCalls += 1;
    return new Response("The current status color is BLUE and this source remains authoritative.", {
      status: 200,
      headers: { "content-type": "text/plain; charset=utf-8" }
    });
  };

  try {
    await runScheduled({ LEASES: kv }, now);
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert(fetchCalls === 10, "legacy KV monitor attempts at most 10 due reverifications even when every attempt throws");
  const summary = JSON.parse(kv.monitorSummary);
  assert(summary.attempted === 10, "monitor summary records the hard attempt envelope");
  assert(summary.checked === 0, "failed reverifications are not misreported as completed checks");
  assert(summary.errors === 10, "each failed reverification is counted as an error");
  assert(summary.due === 10, "monitor stops discovering due work once the attempt envelope is exhausted");

  console.log(`\nSUCCESS: ${passed} monitor attempt-cap checks passed.`);
}

run().catch((error) => {
  console.error("\nMONITOR ATTEMPT CAP TEST FAILED:", error.stack || error.message);
  process.exitCode = 1;
});
