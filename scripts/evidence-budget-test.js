import assert from "node:assert/strict";
import {
  attemptReserveEvidenceAction,
  closeEvidenceBudget,
  createEvidenceBudgetState,
  getEvidenceReservation,
  reserveEvidenceAction,
  settleEvidenceAction,
  settleEvidenceActionConservatively
} from "../src/evidence-budget.js";
import { createEvidenceExecutor } from "../src/evidence-executor.js";
import { finalizeVerificationOutcome } from "../src/verification-outcome.js";

const budget = {
  max_candidate_queries: 2,
  max_source_fetches: 3,
  max_semantic_evaluations: 2,
  max_contradiction_queries: 1,
  latency_budget_ms: 10000,
  hard_cost_ceiling_usd: 0.01
};

let checks = 0;
async function check(name, fn) {
  await fn();
  checks += 1;
  console.log(`ok ${checks} - ${name}`);
}

await check("logical reservation retries do not double-charge", () => {
  let state = createEvidenceBudgetState(budget);
  const action = { kind: "SOURCE_FETCH", idempotency_key: "claim:1:fetch:a", reserve_cost_usd: 0.002 };
  state = reserveEvidenceAction(state, action);
  state = reserveEvidenceAction(state, action);
  assert.equal(state.used.max_source_fetches, 1);
  assert.equal(state.reserved_cost_usd, 0.002);
});

await check("idempotency key cannot be reused for different work", () => {
  let state = createEvidenceBudgetState(budget);
  state = reserveEvidenceAction(state, { kind: "SOURCE_FETCH", idempotency_key: "claim:1:fetch:a", reserve_cost_usd: 0.002 });
  assert.throws(
    () => reserveEvidenceAction(state, { kind: "SOURCE_FETCH", idempotency_key: "claim:1:fetch:a", reserve_cost_usd: 0.003 }),
    /idempotency_conflict/
  );
});

await check("settlement is identity-bound and idempotent", () => {
  let state = createEvidenceBudgetState(budget);
  state = reserveEvidenceAction(state, { kind: "SEMANTIC_EVALUATION", idempotency_key: "claim:1:semantic:a", reserve_cost_usd: 0.004 });
  state = settleEvidenceAction(state, { idempotency_key: "claim:1:semantic:a", actual_cost_usd: 0.0015, outcome: "COMPLETED" });
  state = settleEvidenceAction(state, { idempotency_key: "claim:1:semantic:a", actual_cost_usd: 0.0015, outcome: "COMPLETED" });
  assert.equal(state.reserved_cost_usd, 0);
  assert.equal(state.actual_cost_usd, 0.0015);
  assert.equal(getEvidenceReservation(state, "claim:1:semantic:a").status, "SETTLED");
});

await check("unknown failure cost conservatively settles full reservation", () => {
  let state = createEvidenceBudgetState(budget);
  state = reserveEvidenceAction(state, { kind: "SOURCE_FETCH", idempotency_key: "claim:1:fetch:timeout", reserve_cost_usd: 0.003 });
  state = settleEvidenceActionConservatively(state, { idempotency_key: "claim:1:fetch:timeout", outcome: "TIMEOUT" });
  assert.equal(state.reserved_cost_usd, 0);
  assert.equal(state.actual_cost_usd, 0.003);
  assert.equal(getEvidenceReservation(state, "claim:1:fetch:timeout").outcome, "TIMEOUT");
});

await check("budget denials are structured", () => {
  const state = createEvidenceBudgetState({ ...budget, max_contradiction_queries: 0 });
  const attempt = attemptReserveEvidenceAction(state, {
    kind: "CONTRADICTION_QUERY",
    idempotency_key: "claim:1:contradiction:1",
    reserve_cost_usd: 0.001
  });
  assert.equal(attempt.granted, false);
  assert.equal(attempt.denial.code, "MAX_CONTRADICTION_QUERIES_EXCEEDED");
  assert.equal(attempt.denial.idempotency_key, "claim:1:contradiction:1");
});

await check("settled spend remains committed against hard ceiling", () => {
  let state = createEvidenceBudgetState(budget);
  state = reserveEvidenceAction(state, { kind: "SEMANTIC_EVALUATION", idempotency_key: "claim:1:semantic:a", reserve_cost_usd: 0.006 });
  state = settleEvidenceAction(state, { idempotency_key: "claim:1:semantic:a", actual_cost_usd: 0.006 });
  assert.throws(
    () => reserveEvidenceAction(state, { kind: "SEMANTIC_EVALUATION", idempotency_key: "claim:1:semantic:b", reserve_cost_usd: 0.004000000001 }),
    /hard_cost_ceiling_exceeded/
  );
});

await check("unknown cost is rejected before work", () => {
  const state = createEvidenceBudgetState(budget);
  assert.throws(
    () => reserveEvidenceAction(state, { kind: "SEMANTIC_EVALUATION", idempotency_key: "claim:1:semantic:a" }),
    /invalid_reserve_cost_usd/
  );
});

await check("closed budget denies new work", () => {
  const state = closeEvidenceBudget(createEvidenceBudgetState(budget), "VERDICT_FINALIZED");
  const attempt = attemptReserveEvidenceAction(state, { kind: "CANDIDATE_QUERY", idempotency_key: "claim:1:query:late", reserve_cost_usd: 0 });
  assert.equal(attempt.granted, false);
  assert.equal(attempt.denial.code, "BUDGET_CLOSED:VERDICT_FINALIZED");
});

await check("executor never calls provider after denial", async () => {
  let calls = 0;
  const events = [];
  const executor = createEvidenceExecutor({
    execution_budget: { ...budget, max_contradiction_queries: 0 },
    providers: { CONTRADICTION_QUERY: async () => { calls += 1; return { actual_cost_usd: 0 }; } },
    emit: (event) => events.push(event)
  });
  const result = await executor.run({ kind: "CONTRADICTION_QUERY", idempotency_key: "claim:1:contra:executor", reserve_cost_usd: 0.001 });
  assert.equal(result.status, "DENIED");
  assert.equal(calls, 0);
  assert.equal(events[0].type, "EVIDENCE_BUDGET_DENIED");
});

await check("timeout settles known partial cost on failure path", async () => {
  const executor = createEvidenceExecutor({
    execution_budget: budget,
    providers: {
      CANDIDATE_QUERY: async () => {
        const error = new Error("timed out");
        error.code = "ETIMEDOUT";
        error.actual_cost_usd = 0.0007;
        throw error;
      }
    }
  });
  const result = await executor.run({ kind: "CANDIDATE_QUERY", idempotency_key: "claim:1:query:timeout", reserve_cost_usd: 0.002 });
  assert.equal(result.status, "FAILED");
  assert.equal(result.reservation.outcome, "TIMEOUT");
  assert.equal(executor.snapshot().reserved_cost_usd, 0);
  assert.equal(executor.snapshot().actual_cost_usd, 0.0007);
});

await check("same logical executor work cannot invoke provider twice", async () => {
  let calls = 0;
  const executor = createEvidenceExecutor({
    execution_budget: budget,
    providers: { SOURCE_FETCH: async () => { calls += 1; return { value: calls, actual_cost_usd: 0.001 }; } }
  });
  const action = { kind: "SOURCE_FETCH", idempotency_key: "claim:1:fetch:once", reserve_cost_usd: 0.002 };
  assert.equal((await executor.run(action)).status, "COMPLETED");
  assert.equal((await executor.run(action)).status, "ALREADY_SETTLED");
  assert.equal(calls, 1);
  assert.equal(executor.snapshot().actual_cost_usd, 0.001);
});

const ledger = {
  version: "proofttl-evidence-ledger-v1",
  verdict: "SUPPORTED",
  confidence: 0.91,
  metrics: {},
  evidence_for: [],
  evidence_against: [],
  ambiguous_evidence: [],
  rejected_evidence: []
};

await check("budget truncation withholds overall confidence", () => {
  const outcome = finalizeVerificationOutcome({
    evidence_ledger: ledger,
    execution: {
      denials: [{
        version: "proofttl-evidence-budget-denial-v1",
        code: "MAX_SOURCE_FETCHES_EXCEEDED",
        kind: "SOURCE_FETCH",
        idempotency_key: "claim:1:fetch:9"
      }]
    }
  });
  assert.equal(outcome.verdict, "SUPPORTED");
  assert.equal(outcome.confidence, null);
  assert.equal(outcome.evidence_confidence, 0.91);
  assert.equal(outcome.execution_status, "BUDGET_TRUNCATED");
});

await check("required contradiction pass cannot be skipped into positive final verdict", () => {
  const outcome = finalizeVerificationOutcome({
    evidence_ledger: ledger,
    execution: { contradiction_pass_required: true, contradiction_pass_completed: false }
  });
  assert.equal(outcome.evidence_verdict, "SUPPORTED");
  assert.equal(outcome.verdict, "UNKNOWN");
  assert.equal(outcome.confidence, null);
});

console.log(`SUCCESS: ${checks} evidence budget/executor/outcome checks passed.`);
