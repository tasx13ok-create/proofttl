import core from "../src/index.js";

let passed = 0;

function assert(condition, message) {
  if (!condition) throw new Error(message);
  passed += 1;
  console.log(`PASS ${passed}: ${message}`);
}

class MemoryKV {
  constructor() {
    this.entries = new Map();
  }

  async get(key) {
    return this.entries.get(key)?.value ?? null;
  }

  async put(key, value, options = {}) {
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

async function sha256Fingerprint(value) {
  const bytes = new TextEncoder().encode(value);
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  const hex = [...new Uint8Array(hash)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  return `sha256:${hex}`;
}

function issuedCheck({ observedAt, fingerprint, claim }) {
  return {
    kind: "ISSUED",
    checked_at: observedAt,
    result: "VERIFIED",
    status: "SUPPORTED",
    evidence: claim,
    reason: "exact_claim_text_found_in_source",
    confidence: 0.99,
    verifier: "deterministic-exact-match",
    source_fingerprint: fingerprint,
    final_url: "https://8.8.8.8/source"
  };
}

async function makeLease({
  id,
  nowMs,
  claim,
  sourceText,
  expiresInMs = 10 * 60 * 1000,
  nextCheckOffsetMs = -1000,
  state = "ACTIVE",
  history = null,
  verificationCount = 1
}) {
  const fingerprint = await sha256Fingerprint(sourceText);
  const issuedAt = new Date(nowMs - 30_000).toISOString();
  const expiresAt = new Date(nowMs + expiresInMs).toISOString();
  const firstCheck = issuedCheck({ observedAt: issuedAt, fingerprint, claim });

  return {
    lease_id: id,
    protocol: "ProofTTL/0.3.1",
    claim,
    status: "SUPPORTED",
    source_url: "https://8.8.8.8/source",
    final_url: "https://8.8.8.8/source",
    evidence: claim,
    reason: "exact_claim_text_found_in_source",
    issued_at: issuedAt,
    observed_at: issuedAt,
    expires_at: expiresAt,
    ttl_seconds: Math.max(60, Math.ceil(expiresInMs / 1000)),
    source_fingerprint: fingerprint,
    last_source_fingerprint: fingerprint,
    confidence: 0.99,
    verifier: "deterministic-exact-match",
    proof_basis: "EXACT_TEXT",
    lease_state: state,
    verification_count: verificationCount,
    last_checked_at: issuedAt,
    last_check: firstCheck,
    history: history ?? [firstCheck],
    monitor_interval_seconds: 100,
    next_check_at: state === "ACTIVE"
      ? new Date(nowMs + nextCheckOffsetMs).toISOString()
      : null
  };
}

async function seedLease(kv, lease) {
  await kv.put(`lease:${lease.lease_id}`, JSON.stringify(lease), {
    metadata: {
      lease_state: lease.lease_state,
      expires_at: lease.expires_at,
      next_check_at: lease.next_check_at
    }
  });
}

async function readLease(kv, id) {
  const raw = await kv.get(`lease:${id}`);
  return raw ? JSON.parse(raw) : null;
}

async function runScheduled(env, scheduledTime) {
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

async function withMockFetch(handler, fn) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = handler;
  try {
    return await fn();
  } finally {
    globalThis.fetch = originalFetch;
  }
}

async function testExpiryOnRead() {
  const now = Date.now();
  const kv = new MemoryKV();
  const claim = "status color is BLUE";
  const sourceText = "The current status color is BLUE for this regression fixture.";
  const lease = await makeLease({
    id: "ftl_regression_expired",
    nowMs: now,
    claim,
    sourceText,
    expiresInMs: -1000
  });
  await seedLease(kv, lease);

  const response = await core.fetch(
    new Request(`https://proofttl.test/lease/${lease.lease_id}`),
    { LEASES: kv }
  );
  const body = await response.json();

  assert(response.status === 200, "expired lease read returns HTTP 200");
  assert(body.lease_state === "EXPIRED", "active lease becomes EXPIRED after TTL");
  assert(body.next_check_at === null, "expired lease clears next_check_at");

  const stored = kv.entries.get(`lease:${lease.lease_id}`);
  assert(stored?.metadata?.lease_state === "EXPIRED", "expired state is persisted in KV metadata");
}

async function testRevokedLeaseStaysRevokedAfterExpiry() {
  const now = Date.now();
  const kv = new MemoryKV();
  const claim = "status color is BLUE";
  const sourceText = "The current status color is BLUE for this regression fixture.";
  const lease = await makeLease({
    id: "ftl_regression_revoked_persists",
    nowMs: now,
    claim,
    sourceText,
    expiresInMs: -1000,
    state: "REVOKED"
  });
  lease.revoked_at = new Date(now - 5000).toISOString();
  await seedLease(kv, lease);

  const response = await core.fetch(
    new Request(`https://proofttl.test/lease/${lease.lease_id}`),
    { LEASES: kv }
  );
  const body = await response.json();

  assert(body.lease_state === "REVOKED", "expiry never overwrites a prior REVOKED state");
}

async function testUnchangedSourceMonitorPath() {
  const now = Date.now();
  const kv = new MemoryKV();
  const claim = "status color is BLUE";
  const sourceText = "The current status color is BLUE for this regression fixture and remains stable.";
  const lease = await makeLease({
    id: "ftl_regression_unchanged",
    nowMs: now,
    claim,
    sourceText
  });
  await seedLease(kv, lease);

  await withMockFetch(
    async () => new Response(sourceText, {
      status: 200,
      headers: { "content-type": "text/plain; charset=utf-8" }
    }),
    async () => runScheduled({ LEASES: kv }, now)
  );

  const stored = await readLease(kv, lease.lease_id);
  assert(stored.lease_state === "ACTIVE", "unchanged source keeps lease ACTIVE");
  assert(stored.last_check?.result === "UNCHANGED_SOURCE", "unchanged fingerprint bypasses reverification");
  assert(stored.verification_count === 2, "unchanged automatic check increments verification_count");
  assert(stored.history.length === 2, "unchanged automatic check is appended to history");
  assert(Date.parse(stored.next_check_at) > now, "unchanged active lease schedules its next check");

  const summary = JSON.parse(await kv.get("monitor:last_run"));
  assert(summary.checked === 1, "monitor summary counts the unchanged due lease");
  assert(summary.revoked === 0, "monitor summary does not count unchanged lease as revoked");
  assert(summary.errors === 0, "unchanged monitor path completes without errors");
}

async function testChangedExactEvidenceRevokes() {
  const now = Date.now();
  const kv = new MemoryKV();
  const claim = "status color is BLUE";
  const originalSource = "The current status color is BLUE for this regression fixture and is authoritative.";
  const changedSource = "The current status color is RED for this regression fixture and is authoritative now.";
  const lease = await makeLease({
    id: "ftl_regression_revoke",
    nowMs: now,
    claim,
    sourceText: originalSource
  });
  await seedLease(kv, lease);

  await withMockFetch(
    async () => new Response(changedSource, {
      status: 200,
      headers: { "content-type": "text/plain; charset=utf-8" }
    }),
    async () => runScheduled({ LEASES: kv }, now)
  );

  const stored = await readLease(kv, lease.lease_id);
  assert(stored.lease_state === "REVOKED", "changed source revokes an active exact-evidence lease when original verdict cannot be maintained");
  assert(stored.last_check?.result === "REVOKED", "revocation is recorded as the latest check result");
  assert(stored.revocation?.previous_status === "SUPPORTED", "revocation records the original SUPPORTED verdict");
  assert(stored.revocation?.current_status === "UNKNOWN", "missing exact evidence downgrades the current verdict without AI");
  assert(stored.next_check_at === null, "revoked lease stops future monitoring");
  assert(stored.verification_count === 2, "revocation check increments verification_count");

  const summary = JSON.parse(await kv.get("monitor:last_run"));
  assert(summary.checked === 1, "monitor summary counts the changed due lease");
  assert(summary.revoked === 1, "monitor summary counts the revocation");
  assert(summary.errors === 0, "revocation monitor path completes without errors");
}

async function testHistoryIsCapped() {
  const now = Date.now();
  const kv = new MemoryKV();
  const claim = "status color is BLUE";
  const sourceText = "The current status color is BLUE for this regression fixture and remains stable.";
  const fingerprint = await sha256Fingerprint(sourceText);
  const history = Array.from({ length: 20 }, (_, index) => ({
    kind: "AUTO_REVERIFY",
    checked_at: new Date(now - (20 - index) * 1000).toISOString(),
    result: `OLD_${index}`,
    status: "SUPPORTED",
    source_fingerprint: fingerprint
  }));
  const lease = await makeLease({
    id: "ftl_regression_history_cap",
    nowMs: now,
    claim,
    sourceText,
    history,
    verificationCount: 20
  });
  await seedLease(kv, lease);

  await withMockFetch(
    async () => new Response(sourceText, {
      status: 200,
      headers: { "content-type": "text/plain; charset=utf-8" }
    }),
    async () => runScheduled({ LEASES: kv }, now)
  );

  const stored = await readLease(kv, lease.lease_id);
  assert(stored.history.length === 20, "lease history remains capped at 20 checks");
  assert(stored.history[0]?.result === "OLD_1", "history cap evicts the oldest check first");
  assert(stored.history.at(-1)?.result === "UNCHANGED_SOURCE", "history cap retains the newest automatic check");
  assert(stored.verification_count === 21, "verification_count remains cumulative beyond history cap");
}

async function run() {
  console.log("ProofTTL lease lifecycle regression test\n");

  await testExpiryOnRead();
  await testRevokedLeaseStaysRevokedAfterExpiry();
  await testUnchangedSourceMonitorPath();
  await testChangedExactEvidenceRevokes();
  await testHistoryIsCapped();

  console.log(`\nSUCCESS: ${passed} ProofTTL lease lifecycle regression checks passed.`);
}

run().catch((error) => {
  console.error("\nREGRESSION TEST FAILED:", error.stack || error.message);
  process.exitCode = 1;
});
