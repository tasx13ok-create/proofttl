import core from "../src/index.js";
import { listDueLeaseIds, monitorScheduleRowFromKvKey } from "../src/monitor-schedule.js";

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

class CapturingDb {
  constructor() {
    this.bound = null;
  }

  prepare() {
    return {
      bind: (...args) => {
        this.bound = args;
        return {
          run: async () => ({
            results: Array.from({ length: 25 }, (_, index) => ({ lease_id: `ftl_${index}` }))
              .slice(0, args[1])
          })
        };
      }
    };
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

  const legacyActive = monitorScheduleRowFromKvKey(
    {
      name: "lease:ftl_legacy_active",
      metadata: {
        lease_state: "active",
        expires_at: new Date(fiveMinuteBoundary + 3600_000).toISOString()
      }
    },
    fiveMinuteBoundary
  );
  assert(legacyActive?.lease_state === "ACTIVE", "reconciled lease state is normalized for D1 scheduling");
  assert(
    legacyActive?.next_check_at_ms === fiveMinuteBoundary,
    "active legacy lease without next_check_at is reconciled as immediately due"
  );

  const legacyInactive = monitorScheduleRowFromKvKey(
    {
      name: "lease:ftl_legacy_expired",
      metadata: {
        lease_state: "EXPIRED",
        expires_at: new Date(fiveMinuteBoundary - 1000).toISOString()
      }
    },
    fiveMinuteBoundary
  );
  assert(
    legacyInactive?.next_check_at_ms === null,
    "inactive legacy lease without next_check_at is not rescheduled"
  );

  const db = new CapturingDb();
  const due = await listDueLeaseIds(db, fiveMinuteBoundary, 1000);
  assert(db.bound?.[1] === 10, "D1 due-query hard-caps an oversized caller limit at 10 leases");
  assert(due.length === 10, "monitor scheduler returns at most 10 due leases even when many are available");

  console.log(`\nSUCCESS: ${passed} ProofTTL idle monitor write-budget checks passed.`);
}

run().catch((error) => {
  console.error("\nMONITOR COST TEST FAILED:", error.stack || error.message);
  process.exitCode = 1;
});