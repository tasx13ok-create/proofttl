import assert from "node:assert/strict";
import { handleTextAssistant } from "../src/assistant-text.js";
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
        const prompt = input?.messages?.map((item) => item.content).join("\n") || "";
        if (/what is proofttl/i.test(last)) {
          return { response: "ProofTTL turns changing factual claims into source-backed Fact Leases that expire and can be rechecked when evidence changes." };
        }
        if (/why is the sky blue/i.test(last)) {
          return { response: "The sky looks blue because Earth's atmosphere scatters shorter blue wavelengths of sunlight more strongly than longer red wavelengths." };
        }
        if (/give me something/i.test(last) && /active conversation is coding/i.test(prompt)) {
          return { response: "Let's build a tiny counter.\n\n```javascript\nlet count = 0;\nfor (let i = 0; i < 5; i++) count += i;\nconsole.log(count);\n```" };
        }
        return { response: "A Fact Lease is a source-backed claim with an expiry." };
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

const env = makeEnv();

const wrongType = await handleTextAssistant(req({ message: "hello" }, "text/plain"), env);
assert.equal(wrongType.status, 415);
let quota = await getAssistantQuota(req({ message: "status" }), env);
assert.equal(quota.used, 0, "invalid content type must not spend daily quota");

const nav = await handleTextAssistant(req({ message: "open pricing" }), env);
assert.equal(nav.status, 200);
const navBody = await nav.json();
assert.equal(navBody.action?.type, "navigate");
assert.equal(env.calls.length, 0, "deterministic navigation must not invoke the text model");
quota = await getAssistantQuota(req({ message: "status" }), env);
assert.equal(quota.used, 0, "deterministic navigation must not spend AI quota");

const gameStartMessage = "Let's play Tic Tac Toe! I'll be X, and you'll be O.";
const gameStart = await handleTextAssistant(req({ message: gameStartMessage }), env);
assert.equal(gameStart.status, 200);
const gameStartBody = await gameStart.json();
assert.equal(gameStartBody.inference?.deterministic_route, true, "Tic-Tac-Toe must use deterministic state, not model memory");
assert.equal(gameStartBody.inference?.game_engine, "tic_tac_toe_v1");
assert.deepEqual(gameStartBody.context?.game?.state?.board, [null,null,null,null,null,null,null,null,null]);
assert.match(gameStartBody.response, /1 \| 2 \| 3/);
assert.equal(env.calls.length, 0, "starting a deterministic game must not invoke the model");

const gameHistory = [
  { role: "user", content: gameStartMessage },
  { role: "assistant", content: gameStartBody.response }
];
const gameMove = await handleTextAssistant(req({ message: "9", history: gameHistory }), env);
assert.equal(gameMove.status, 200);
const gameMoveBody = await gameMove.json();
const gameBoard = gameMoveBody.context?.game?.state?.board;
assert.equal(gameBoard?.[8], "X", "the user's square 9 move must remain on square 9");
assert.equal(gameBoard?.filter((cell) => cell === "X").length, 1, "one user move must create exactly one X");
assert.equal(gameBoard?.filter((cell) => cell === "O").length, 1, "L.O.V.E. must make exactly one legal reply move");
assert.notEqual(gameMoveBody.context?.game?.state?.status, "assistant_won", "L.O.V.E. cannot win immediately after the user's first move");
assert.doesNotMatch(gameMoveBody.response, /three in a row|congratulations, i win/i, "the first reply cannot fabricate a win");
assert.equal(env.calls.length, 0, "deterministic game moves must not invoke the model");
quota = await getAssistantQuota(req({ message: "status" }), env);
assert.equal(quota.used, 0, "deterministic game turns must not spend AI quota");

const about = await handleTextAssistant(req({ message: "what is proofttl" }), env);
assert.equal(about.status, 200);
const aboutBody = await about.json();
assert.match(aboutBody.response, /Fact Lease/i);
assert.equal(aboutBody.inference?.deterministic_route, false);
assert.ok(aboutBody.inference?.response_model, "normal product questions should use the conversational model");
assert.equal(env.calls.length, 1, "product conversation should invoke the lightweight model");
quota = await getAssistantQuota(req({ message: "status" }), env);
assert.equal(quota.used, 1, "conversational product questions spend AI quota");

const general = await handleTextAssistant(req({ message: "why is the sky blue" }), env);
assert.equal(general.status, 200);
const generalBody = await general.json();
assert.match(generalBody.response, /atmosphere|wavelength/i, "general non-ProofTTL questions must receive normal model answers");
assert.equal(generalBody.action, null);
assert.equal(env.calls.length, 2, "general conversation should invoke the model normally");
const generalPrompt = env.calls[1].input.messages.map((item) => item.content).join("\n");
assert.match(generalPrompt, /general-purpose AI assistant/i, "general-purpose scope must be explicit");
assert.doesNotMatch(generalPrompt, /working scope is ProofTTL|ProofTTL-only boundary applies/i, "legacy ProofTTL-only refusal rules must stay removed");

const codingHistory = [
  { role: "user", content: "good, lets code" },
  { role: "assistant", content: "Sure. What should we build?" }
];
const coding = await handleTextAssistant(req({ message: "anything give me something", history: codingHistory }), env);
assert.equal(coding.status, 200);
const codingBody = await coding.json();
assert.equal(codingBody.context?.coding_context, true, "short follow-ups must inherit active coding context");
assert.match(codingBody.response, /```javascript\n/, "coding replies must preserve fenced code formatting");
assert.match(codingBody.response, /console\.log/, "runnable code must survive response cleaning");
assert.match(env.calls.at(-1).input.messages.map((item) => item.content).join("\n"), /Pick a useful mini-project now/i, "vague coding follow-ups must get a concrete-project instruction");

const history = [
  { role: "user", content: "old 1" },
  { role: "assistant", content: "old 2" },
  { role: "user", content: "recent 1" },
  { role: "assistant", content: "recent 2" },
  { role: "user", content: "recent 3" },
  { role: "assistant", content: "recent 4" },
  { role: "user", content: "recent 5" },
  { role: "assistant", content: "x".repeat(800) },
  { role: "system", content: "must be discarded" }
];

const answer = await handleTextAssistant(req({
  message: "Tell me how the verifier decides whether semantic evidence is enough.",
  history
}), env);
assert.equal(answer.status, 200);
const answerBody = await answer.json();
assert.match(answerBody.response, /Fact Lease/i);
assert.equal(answerBody.context.history_messages_used, 5, "invalid history roles are removed after six-message tail bounding");
assert.equal(answerBody.quota.used, 4);
assert.equal(answerBody.quota.remaining, 16);

const sentMessages = env.calls.at(-1).input.messages;
assert.equal(sentMessages[0].role, "system");
assert.equal(sentMessages.at(-1).role, "user");
assert.equal(sentMessages.at(-1).content, "Tell me how the verifier decides whether semantic evidence is enough.");
assert.equal(sentMessages.some((item) => item.content === "old 1"), false, "old history falls outside the bounded context window");
assert.equal(sentMessages.some((item) => item.role === "system" && item.content === "must be discarded"), false, "caller cannot inject a system-role history message");
const longHistoryItem = sentMessages.find((item) => item.role === "assistant" && /^x+$/.test(item.content));
assert.equal(longHistoryItem.content.length, 600, "history entries are individually bounded");

console.log("assistant text contract checks passed");
