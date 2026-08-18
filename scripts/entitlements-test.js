import assert from "node:assert/strict";
import { resolveStoredAssistantEntitlement } from "../src/entitlements.js";

let checks = 0;
async function check(name, fn) {
  await fn();
  checks += 1;
  console.log(`ok ${checks} - ${name}`);
}

function fakeDb(row, { throwOnFirst = false } = {}) {
  return {
    prepare() {
      return {
        bind() {
          return {
            async first() {
              if (throwOnFirst) throw new Error("db_failed");
              return row;
            }
          };
        }
      };
    }
  };
}

const freeLimit = 20;
const future = Date.now() + 60_000;
const past = Date.now() - 60_000;

await check("missing database safely falls back to signed-in free", async () => {
  const result = await resolveStoredAssistantEntitlement("user-1", {}, freeLimit);
  assert.equal(result.authenticated, true);
  assert.equal(result.plan, "free");
  assert.equal(result.limit, freeLimit);
});

await check("missing entitlement row safely falls back to free", async () => {
  const result = await resolveStoredAssistantEntitlement(
    "user-1",
    { MONITOR_DB: fakeDb(null) },
    freeLimit
  );
  assert.equal(result.plan, "free");
  assert.equal(result.membership_status, "inactive");
  assert.equal(result.limit, freeLimit);
});

await check("active member receives stored assistant limit", async () => {
  const result = await resolveStoredAssistantEntitlement(
    "user-1",
    {
      MONITOR_DB: fakeDb({
        plan: "member",
        membership_status: "active",
        assistant_daily_limit: 333,
        period_end_ms: future,
        source: "billing"
      }),
      PROOFTTL_MEMBER_ASSISTANT_DAILY_MESSAGES: "200"
    },
    freeLimit
  );
  assert.equal(result.plan, "member");
  assert.equal(result.membership_status, "active");
  assert.equal(result.limit, 333);
  assert.equal(result.source, "billing");
});

await check("active member without stored override receives configured member limit", async () => {
  const result = await resolveStoredAssistantEntitlement(
    "user-2",
    {
      MONITOR_DB: fakeDb({
        plan: "member",
        membership_status: "active",
        assistant_daily_limit: null,
        period_end_ms: future,
        source: "billing"
      }),
      PROOFTTL_MEMBER_ASSISTANT_DAILY_MESSAGES: "250"
    },
    freeLimit
  );
  assert.equal(result.plan, "member");
  assert.equal(result.limit, 250);
});

await check("expired member safely falls back to free limit", async () => {
  const result = await resolveStoredAssistantEntitlement(
    "user-3",
    { MONITOR_DB: fakeDb({ plan: "member", membership_status: "active", assistant_daily_limit: 999, period_end_ms: past, source: "billing" }) },
    freeLimit
  );
  assert.equal(result.plan, "free");
  assert.equal(result.limit, freeLimit);
});

await check("inactive member safely falls back to free limit", async () => {
  const result = await resolveStoredAssistantEntitlement(
    "user-4",
    { MONITOR_DB: fakeDb({ plan: "member", membership_status: "inactive", assistant_daily_limit: 999, period_end_ms: future, source: "billing" }) },
    freeLimit
  );
  assert.equal(result.plan, "free");
  assert.equal(result.limit, freeLimit);
});

await check("unknown active plan does not gain member access", async () => {
  const result = await resolveStoredAssistantEntitlement(
    "user-5",
    { MONITOR_DB: fakeDb({ plan: "enterprise-magic", membership_status: "active", assistant_daily_limit: 9999, period_end_ms: future, source: "manual" }) },
    freeLimit
  );
  assert.equal(result.plan, "free");
  assert.equal(result.limit, freeLimit);
});

await check("database errors fail closed to free", async () => {
  const result = await resolveStoredAssistantEntitlement(
    "user-6",
    { MONITOR_DB: fakeDb(null, { throwOnFirst: true }) },
    freeLimit
  );
  assert.equal(result.plan, "free");
  assert.equal(result.limit, freeLimit);
});

console.log(`\n${checks} entitlement checks passed.`);
