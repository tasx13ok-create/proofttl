import {
  createLeaseStoreBinding,
  reconcileMonitorScheduleFromKv
} from "../src/lease-store.js";
import { verifyLeaseIssuanceSignature } from "../src/lease-signing.js";

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
    const offset = options.cursor ? Number.parseInt(options.cursor, 10) || 0 : 0;
    const names = [...this.entries.keys()].filter((name) => name.startsWith(prefix));
    const page = names.slice(offset, offset + limit);
    const keys = page.map((name) => {
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
    const nextOffset = offset + page.length;
    const listComplete = nextOffset >= names.length;
    return {
      keys,
      list_complete: listComplete,
      ...(listComplete ? {} : { cursor: String(nextOffset) })
    };
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
  const issuedAt = new Date(nowMs).toISOString();
  return {
    lease_id: id,
    protocol: "ProofTTL/0.3.1",
    claim: "Example.com is intended for illustrative examples in documents.",
    status: "SUPPORTED",
    source_url: "https://example.com",
    final_url: "https://example.com/",
    evidence: "This domain is for use in illustrative examples in documents.",
    reason: "semantic_support",
    issued_at: issuedAt,
    observed_at: issuedAt,
    ttl_seconds: 600,
    source_fingerprint: "sha256:d003f90bc10db991b76e6fb480123cfce2cbb2b2784abe687fccccfa7ecacad8",
    confidence: 0.95,
    verifier: "proofttl-hybrid:qwen3-primary+llama70b-fallback",
    proof_basis: "SEMANTIC",
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

  const oddMinuteStore = createLeaseStoreBinding(kvFallback, null, { monitorNow: base + 60_000 });
  const odd = await oddMinuteStore.list({ prefix: "lease:", limit: 1000 });
  assert(odd.keys.length === 0, "fallback skips KV list on odd scheduled minutes");
  assert(kvFallback.listCalls.length === 0, "odd-minute fallback consumes zero KV list calls");

  const evenMinuteStore = createLeaseStoreBinding(kvFallback, null, { monitorNow: base + 120_000 });
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
  await indexedStore.put(`lease:${lease.lease_id}`, JSON.stringify(lease), { metadata: { lease_state: "ACTIVE" } });
  assert(kvIndexed.putCalls.length === 1, "lease write persists to KV");
  assert(db.runs.some((item) => item.sql.includes("INSERT INTO monitor_schedule")), "lease write upserts D1 schedule index");

  await indexedStore.get("lease:ftl_missing");
  assert(db.runs.some((item) => item.sql.includes("SET lease_state = 'MISSING'")), "missing KV lease is marked inactive in D1");

  const signingPair = await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]);
  const signingPrivateJwk = await crypto.subtle.exportKey("jwk", signingPair.privateKey);
  const signingPublicJwk = await crypto.subtle.exportKey("jwk", signingPair.publicKey);
  const kvSigned = new FakeKV();
  const signedStore = createLeaseStoreBinding(kvSigned, null, { signingPrivateJwk, signingKeyId: "proofttl-test-key" });
  const signableLease = makeLease("ftl_signed", base);
  await signedStore.put(`lease:${signableLease.lease_id}`, JSON.stringify(signableLease));
  const storedSignedLease = JSON.parse(kvSigned.entries.get("lease:ftl_signed"));
  assert(storedSignedLease.signature?.algorithm === "Ed25519", "KV adapter persists Ed25519 signature envelope");
  assert(storedSignedLease.signature?.key_id === "proofttl-test-key", "stored signature preserves configured key ID");
  assert(await verifyLeaseIssuanceSignature(storedSignedLease, signingPublicJwk), "stored Fact Lease signature verifies with public key");

  const shardChars = "0123456789abcdef";
  const expectedShard = shardChars[Math.floor(Math.floor(base / 60_000) / 5) % shardChars.length];
  const kvReconcile = new FakeKV();
  for (let index = 0; index < 1001; index += 1) {
    const id = `ftl_${expectedShard}${String(index).padStart(4, "0")}`;
    kvReconcile.entries.set(`lease:${id}`, JSON.stringify(makeLease(id, base)));
  }
  const otherShard = expectedShard === "f" ? "0" : shardChars[shardChars.indexOf(expectedShard) + 1];
  kvReconcile.entries.set(`lease:ftl_${otherShard}abc`, JSON.stringify(makeLease(`ftl_${otherShard}abc`, base)));

  const reconcileDb = new FakeD1();
  const reconcile = await reconcileMonitorScheduleFromKv({ LEASES: kvReconcile, MONITOR_DB: reconcileDb }, base);
  assert(reconcile.attempted === true, "five-minute boundary runs reconciliation");
  assert(kvReconcile.listCalls.length === 2, "reconciliation paginates past the first 1,000 KV keys");
  assert(kvReconcile.listCalls[0].prefix === `lease:ftl_${expectedShard}`, "reconciliation rotates through deterministic hex shards");
  assert(kvReconcile.listCalls[1].cursor === "1000", "reconciliation forwards the KV cursor to the next page");
  assert(reconcile.pages === 2, "reconciliation reports every KV page visited");
  assert(reconcile.reconciled === 1001, "reconciliation indexes every selected-shard lease without 100-row truncation");
  assert(reconcileDb.batches.length === 11, "D1 reconciliation remains chunked to batches of at most 100 statements");
  assert(reconcileDb.batches.every((size) => size <= 100), "every D1 reconciliation batch respects the 100-row cap");

  const skipped = await reconcileMonitorScheduleFromKv({ LEASES: kvReconcile, MONITOR_DB: reconcileDb }, base + 60_000);
  assert(skipped.attempted === false, "non-boundary minute skips reconciliation");

  console.log(`\nSUCCESS: ${passed} lease-store scheduler checks passed.`);
}

run().catch((error) => {
  console.error("\nLEASE STORE TEST FAILED:", error.stack || error.message);
  process.exitCode = 1;
});
