import {
  createLeaseStoreBinding,
  reconcileMonitorScheduleFromKv
} from "../src/lease-store.js";

let passed = 0;

function assert(condition, message) {
  if (!condition) throw new Error(message);
  passed += 1;
  console.log(`PASS ${passed}: ${message}`);
}

class FakeKV {
  constructor() {
    this.entries = new Map();
    this.listCalls = [];
    this.putCalls = [];
  }

  async get(key) {
    return this.entries.get(key) ?? null;
  }

  async put(key, value, options = {}) {
    this.putCalls.push({ key, value, options });
    this.entries.set(key, String(value));
  }

  async list(options = {}) {
    this.listCalls.push(options);
    const prefix = options.prefix || "";
    const limit = options.limit || 1000;
    const keys = [...this.entries.keys()]
      .filter((name) => name.startsWith(prefix))
      .slice(0, limit)
      .map((name) => {
        const raw = this.entries.get(name);
        let metadata = null;
        try {
          const lease = JSON.parse(raw);
          metadata = {
            lease_state: lease.lease_state,
            expires_at: lease.expires_at,
            next_check_at: lease.next_check_at
          };
        } catch {}
        return { name, metadata };
      });
    return { keys, list_complete: true };
  }
}

class FakeStatement {
  constructor(db, sql) {
    this.db = db;
    this.sql = sql;
    this.values = [];
  }

  bind(...values) {
    this.values = values;
    return this;
  }

  async run() {
    this.db.runs.push({ sql: this.sql, values: this.values });
    if (this.sql.includes("SELECT lease_id")) {
      return { results: this.db.dueIds.map((lease_id) => ({ lease_id })) };
    }
    return { success: true, results: [] };
  }
}

class FakeD1 {
  constructor(dueIds = []) {
    this.dueIds = dueIds;
    this.runs = [];
    this.batches = [];
  }

  prepare(sql) {
    return new FakeStatement(this, sql);
  }

  async batch(statements) {
    this.batches.push(statements.length);
    return Promise.all(statements.map((statement) => statement.run()));
  }
}

function makeLease(id, nowMs) {
  return {
    lease_id: id,
    lease_state: "ACTIVE",
    expires_at: new Date(nowMs + 600_000).toISOString(),
    next_check_at: new Date(nowMs + 60_000).toISOString()
  };
}

async function run() {
  console.log("ProofTTL lease-store scheduler adapter tests\n");

  const base = Date.UTC(2026, 7, 18, 6, 0, 0);

  const kvFallback = new FakeKV();
  kvFallback.entries.set("lease:ftl_a1", JSON.stringify(makeLease("ftl_a1", base)));

  const oddMinuteStore = createLeaseStoreBinding(kvFallback, null, {
    monitorNow: base + 60_000
  });
  const odd = await oddMinuteStore.list({ prefix: "lease:", limit: 1000 });
  assert(odd.keys.length === 0, "fallback skips KV list on odd scheduled minutes");
  assert(kvFallback.listCalls.length === 0, "odd-minute fallback consumes zero KV list calls");

  const evenMinuteStore = createLeaseStoreBinding(kvFallback, null, {
    monitorNow: base + 120_000
  });
  const even = await evenMinuteStore.list({ prefix: "lease:", limit: 1000 });
  assert(even.keys.length === 1, "fallback lists leases every two minutes");
  assert(kvFallback.listCalls.length === 1, "two-minute fallback consumes one KV list call");
  assert((24 * 60) / 2 === 720, "fallback projects to 720 KV list calls per day");

  const kvIndexed = new FakeKV();
  const db = new FakeD1(["ftl_due_1", "ftl_due_2"]);
  const indexedStore = createLeaseStoreBinding(kvIndexed, db, { monitorNow: base });
  const indexed = await indexedStore.list({ prefix: "lease:", limit: 10 });
  assert(indexed.keys.length === 2, "D1 due query returns only indexed due leases");
  assert(indexed.keys[0].name === "lease:ftl_due_1", "D1 lease IDs are converted to KV keys");
  assert(kvIndexed.listCalls.length === 0, "D1 monitor path does not list KV");

  const lease = makeLease("ftl_write", base);
  await indexedStore.put(`lease:${lease.lease_id}`, JSON.stringify(lease), {
    metadata: { lease_state: "ACTIVE" }
  });
  assert(kvIndexed.putCalls.length === 1, "lease write persists to KV first");
  assert(
    db.runs.some((item) => item.sql.includes("INSERT INTO monitor_schedule")),
    "lease write upserts D1 schedule index"
  );

  await indexedStore.get("lease:ftl_missing");
  assert(
    db.runs.some((item) => item.sql.includes("SET lease_state = 'MISSING'")),
    "missing KV lease is marked inactive in D1"
  );

  const shardChars = "0123456789abcdef";
  const expectedShard = shardChars[
    Math.floor(Math.floor(base / 60_000) / 5) % shardChars.length
  ];
  const kvReconcile = new FakeKV();
  kvReconcile.entries.set(
    `lease:ftl_${expectedShard}abc`,
    JSON.stringify(makeLease(`ftl_${expectedShard}abc`, base))
  );
  const otherShard = expectedShard === "f" ? "0" : shardChars[shardChars.indexOf(expectedShard) + 1];
  kvReconcile.entries.set(
    `lease:ftl_${otherShard}abc`,
    JSON.stringify(makeLease(`ftl_${otherShard}abc`, base))
  );
  const reconcileDb = new FakeD1();
  const reconcile = await reconcileMonitorScheduleFromKv(
    { LEASES: kvReconcile, MONITOR_DB: reconcileDb },
    base
  );
  assert(reconcile.attempted === true, "five-minute boundary runs reconciliation");
  assert(kvReconcile.listCalls.length === 1, "reconciliation uses one KV list call");
  assert(
    kvReconcile.listCalls[0].prefix === `lease:ftl_${expectedShard}`,
    "reconciliation rotates through deterministic hex shards"
  );
  assert(reconcile.reconciled === 1, "reconciliation indexes the selected shard");

  const skipped = await reconcileMonitorScheduleFromKv(
    { LEASES: kvReconcile, MONITOR_DB: reconcileDb },
    base + 60_000
  );
  assert(skipped.attempted === false, "non-boundary minute skips reconciliation");

  console.log(`\nSUCCESS: ${passed} lease-store scheduler checks passed.`);
}

run().catch((error) => {
  console.error("\nLEASE STORE TEST FAILED:", error.stack || error.message);
  process.exitCode = 1;
});
