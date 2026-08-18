import assert from "node:assert/strict";
import { getDeploymentReadiness } from "../src/readiness.js";

let checks = 0;
async function check(name, fn) {
  await fn();
  checks += 1;
  console.log(`ok ${checks} - ${name}`);
}

const requiredTables = new Set([
  "monitor_schedule",
  "session",
  "assistant_usage_daily",
  "account_entitlement"
]);

function fakeDb() {
  return {
    prepare(sql) {
      return {
        bind(value) {
          return {
            async first() {
              if (/sqlite_master/.test(sql)) return requiredTables.has(value) ? { ok: 1 } : null;
              return null;
            }
          };
        }
      };
    }
  };
}

function limiter() {
  return { async limit() { return { success: true }; } };
}

function completeEnv() {
  return {
    LEASES: {},
    AI: { run() {} },
    VERIFY_RATE_LIMITER: limiter(),
    PAYER_VERIFY_RATE_LIMITER: limiter(),
    ASSISTANT_RATE_LIMITER: limiter(),
    MONITOR_DB: fakeDb(),
    CDP_API_KEY_ID: "id",
    CDP_API_KEY_SECRET: "secret",
    PROOFTTL_SIGNING_PRIVATE_JWK: "{}",
    BETTER_AUTH_SECRET: "auth-secret",
    PROOFTTL_AUTH_TRUSTED_ORIGINS: "https://proofttl-web-git-main-tasx13ok-1769s-projects.vercel.app",
    PROOFTTL_AUTH_CROSS_ORIGIN: "true",
    PROOFTTL_ASSISTANT_FREE_DAILY_MESSAGES: "20",
    PROOFTTL_MEMBER_ASSISTANT_DAILY_MESSAGES: "200"
  };
}

const request = new Request("https://proofttl.tasx13ok.workers.dev/readiness");

await check("complete testnet environment scores 100", async () => {
  const result = await getDeploymentReadiness(completeEnv(), request);
  assert.equal(result.testnet.ready, true);
  assert.equal(result.testnet.score, 100);
  assert.equal(result.testnet.passing_checks, result.testnet.total_checks);
});

await check("browser session path is required for readiness", async () => {
  const env = completeEnv();
  delete env.PROOFTTL_AUTH_TRUSTED_ORIGINS;
  const result = await getDeploymentReadiness(env, request);
  assert.equal(result.testnet.ready, false);
  assert.equal(result.testnet.checks.trusted_browser_origin, false);
  assert(result.testnet.score < 100);
});

await check("cross-origin cookie mode is required for readiness", async () => {
  const env = completeEnv();
  env.PROOFTTL_AUTH_CROSS_ORIGIN = "false";
  const result = await getDeploymentReadiness(env, request);
  assert.equal(result.testnet.ready, false);
  assert.equal(result.testnet.checks.cross_origin_session_cookies, false);
});

await check("missing entitlement schema fails readiness", async () => {
  const env = completeEnv();
  const original = requiredTables.delete("account_entitlement");
  try {
    const result = await getDeploymentReadiness(env, request);
    assert.equal(result.testnet.ready, false);
    assert.equal(result.testnet.checks.account_entitlement_schema, false);
  } finally {
    if (original) requiredTables.add("account_entitlement");
  }
});

await check("production remains locked independently of testnet readiness", async () => {
  const result = await getDeploymentReadiness(completeEnv(), request);
  assert.equal(result.testnet.ready, true);
  assert.equal(result.production.ready, false);
  assert(result.production.blockers.includes("mainnet_payment_validation"));
  assert(result.production.blockers.includes("paid_membership_billing"));
});

console.log(`\n${checks} readiness checks passed.`);
