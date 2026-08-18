import assert from "node:assert/strict";
import {
  assistantQuotaLimit,
  consumeAssistantQuota,
  getAssistantQuota
} from "../src/assistant-quota.js";

function request(ip = "203.0.113.44") {
  return new Request("https://proofttl.test/assistant/usage", {
    headers: { "cf-connecting-ip": ip }
  });
}

function kv() {
  const data = new Map();
  return {
    data,
    async get(key) {
      return data.get(key) ?? null;
    },
    async put(key, value) {
      data.set(key, value);
    }
  };
}

const store = kv();
const env = {
  LEASES: store,
  PROOFTTL_ASSISTANT_FREE_DAILY_MESSAGES: "3"
};

assert.equal(assistantQuotaLimit(env), 3);

const first = await consumeAssistantQuota(request(), env);
assert.equal(first.allowed, true);
assert.equal(first.used, 1);
assert.equal(first.remaining, 2);
assert.equal(first.accounting_backend, "kv_fallback");

const second = await consumeAssistantQuota(request(), env);
assert.equal(second.allowed, true);
assert.equal(second.used, 2);
assert.equal(second.remaining, 1);

const third = await consumeAssistantQuota(request(), env);
assert.equal(third.allowed, true);
assert.equal(third.used, 3);
assert.equal(third.remaining, 0);

const fourth = await consumeAssistantQuota(request(), env);
assert.equal(fourth.allowed, false);
assert.equal(fourth.remaining, 0);

const status = await getAssistantQuota(request(), env);
assert.equal(status.used, 3);
assert.equal(status.remaining, 0);

const storedKeys = [...store.data.keys()];
assert.equal(storedKeys.length, 1);
assert.equal(storedKeys[0].includes("203.0.113.44"), false, "raw IP must not be stored in quota key");
assert.match(storedKeys[0], /^assistant-free:\d{4}-\d{2}-\d{2}:[a-f0-9]{64}$/);

const otherClient = await getAssistantQuota(request("203.0.113.45"), env);
assert.equal(otherClient.used, 0);
assert.equal(otherClient.remaining, 3);

console.log("assistant quota checks passed");
