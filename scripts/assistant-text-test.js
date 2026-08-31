import assert from "node:assert/strict";
import {
  handleTextAssistant,
  isProofTTLAssistantScope,
  outOfScopeProofTTLResponse
} from "../src/assistant-text.js";
import { getAssistantQuota } from "../src/assistant-quota.js";

function makeKv() {
  const data = new Map();
  return {
    async get(key) { return data.get(key) ?? null; },
    async put(key, value) { data.set(key, value); }
  };
}

function makeEnv() {
  const calls = [];
  return {
    calls,
    AI: {
      async run(model, input) {
        calls.push({ model, input });
        const last = input?.messages?.at(-1)?.content || "";
        if (/what is proofttl/i.test(last)) {
          return { response: "ProofTTL verifies claims against evidence, records verdict context, and can monitor source-backed Fact Leases for change." };
        }
        if (/contradiction pass/i.test(last)) {
          return { response: "The contradiction pass actively looks for authoritative evidence against the leading conclusion before approval." };
        }
        return { response: "ProofTTL keeps the evidence chain explicit and requires human approval before customer-facing Fact Audit publication." };
      }
    },
    ASSISTANT_RATE_LIMITER: {
      async limit() { return { success: true }; }
    },
    LEASES: makeKv(),
    PROOFTTL_ASSISTANT_FREE_DAILY_MESSAGES: "20"
  };
}

function req(body, contentType = "application/json") {
  return new Request("https://proofttl.test/assistant/text", {
    method: "POST",
    headers: {
      "content-type": contentType,
      "cf-connecting-ip": "203.0.113.77"
    },
    body: typeof body === "string" ? body : JSON.stringify(body)
  });
}

assert.equal(isProofTTLAssistantScope("verify this claim against authoritative evidence"), true);
assert.equal(isProofTTLAssistantScope("run a contradiction pass on this Fact Audit"), true);
assert.equal(isProofTTLAssistantScope("what is the weather tomorrow"), false);
assert.equal(isProofTTLAssistantScope("write me Python code"), false);
assert.match(outOfScopeProofTTLResponse(), /scoped strictly to ProofTTL/i);

const env = makeEnv();

const wrongType = await handleTextAssistant(req({ message: "verify this claim" }, "text/plain"), env);
assert.equal(wrongType.status, 415);
let quota = await getAssistantQuota(req({ message: "status" }), env);
assert.equal(quota.used, 0, "invalid content type must not spend daily quota");

const nav = await handleTextAssistant(req({ message: "open pricing" }), env);
assert.equal(nav.status, 200);
const navBody = await nav.json();
assert.equal(navBody.action?.type, "navigate");
assert.equal(env.calls.length, 0, "deterministic ProofTTL navigation must not invoke the text model");
quota = await getAssistantQuota(req({ message: "status" }), env);
assert.equal(quota.used, 0, "deterministic navigation must not spend AI quota");

for (const message of [
  "why is the sky blue",
  "write me Python code for a snake game",
  "plan my vacation to Miami",
  "draft an email to my boss",
  "what is the weather tomorrow",
  "open my calendar",
  "help me with my bank account"
]) {
  const beforeCalls = env.calls.length;
  const beforeQuota = await getAssistantQuota(req({ message: "status" }), env);
  const response = await handleTextAssistant(req({ message }), env);
  assert.equal(response.status, 200, `out-of-scope request should be deterministically redirected: ${message}`);
  const body = await response.json();
  assert.match(body.response, /scoped strictly to ProofTTL/i);
  assert.equal(body.inference?.scope, "out_of_scope");
  assert.equal(body.inference?.provider_invoked, false);
  assert.equal(env.calls.length, beforeCalls, "out-of-scope request must not invoke a model provider");
  const afterQuota = await getAssistantQuota(req({ message: "status" }), env);
  assert.equal(afterQuota.used, beforeQuota.used, "out-of-scope request must not consume AI quota");
}

const about = await handleTextAssistant(req({ message: "what is proofttl" }), env);
assert.equal(about.status, 200);
const aboutBody = await about.json();
assert.match(aboutBody.response, /ProofTTL|verif/i);
assert.equal(aboutBody.inference?.deterministic_route, false);
assert.equal(aboutBody.inference?.scope, "proofttl");
assert.ok(aboutBody.inference?.response_model, "ProofTTL questions should use the configured conversational model");
assert.equal(env.calls.length, 1, "ProofTTL conversation should invoke the model");
quota = await getAssistantQuota(req({ message: "status" }), env);
assert.equal(quota.used, 1, "in-scope model requests spend AI quota");

const prompt = env.calls[0].input.messages.map((item) => item.content).join("\n");
assert.match(prompt, /stay strictly inside ProofTTL work/i);
assert.match(prompt, /do not answer unrelated general knowledge, coding, writing, planning/i);
assert.match(prompt, /human approval is required/i);
assert.doesNotMatch(prompt, /general-purpose AI assistant/i);

const contradiction = await handleTextAssistant(req({ message: "run the contradiction pass on this claim" }), env);
assert.equal(contradiction.status, 200);
const contradictionBody = await contradiction.json();
assert.match(contradictionBody.response, /contradiction|evidence/i);
assert.equal(contradictionBody.inference?.scope, "proofttl");
assert.equal(env.calls.length, 2);

const inheritedHistory = [
  { role: "user", content: "Review the evidence for this Fact Audit claim." },
  { role: "assistant", content: "The FOR evidence is stronger, but the contradiction pass is still pending." }
];
assert.equal(isProofTTLAssistantScope("what next", inheritedHistory), true, "short follow-up may inherit a ProofTTL topic");
assert.equal(isProofTTLAssistantScope("write me a poem", inheritedHistory), false, "explicit topic switch must not inherit ProofTTL scope");

const inherited = await handleTextAssistant(req({ message: "what next", history: inheritedHistory }), env);
assert.equal(inherited.status, 200);
const inheritedBody = await inherited.json();
assert.equal(inheritedBody.inference?.scope, "proofttl");
assert.equal(env.calls.length, 3);

const switched = await handleTextAssistant(req({ message: "write me a poem", history: inheritedHistory }), env);
const switchedBody = await switched.json();
assert.equal(switchedBody.inference?.scope, "out_of_scope");
assert.equal(env.calls.length, 3, "explicit off-topic switch must not reach provider even after ProofTTL history");

await env.LEASES.put("lease:ftl_1234567890abcdef", JSON.stringify({
  lease_id: "ftl_1234567890abcdef",
  claim: "Example claim",
  current_status: "SUPPORTED",
  confidence: 0.91,
  expires_at: "2026-09-07T00:00:00Z"
}));
const lease = await handleTextAssistant(req({ message: "check Fact Lease ftl_1234567890abcdef and explain its current verdict" }), env);
assert.equal(lease.status, 200);
const leaseBody = await lease.json();
assert.equal(leaseBody.context?.lease_grounding?.found, true);
assert.equal(leaseBody.context?.lease_grounding?.lease_id, "ftl_1234567890abcdef");
assert.equal(env.calls.length, 4);
const leasePrompt = env.calls.at(-1).input.messages.map((item) => item.content).join("\n");
assert.match(leasePrompt, /Authoritative live Fact Lease data follows/i);
assert.match(leasePrompt, /ftl_1234567890abcdef/i);

console.log("assistant text ProofTTL scope contract checks passed");
