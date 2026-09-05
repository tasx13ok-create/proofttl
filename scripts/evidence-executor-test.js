import assert from "node:assert/strict";
import { createEvidenceExecutor } from "../src/evidence-executor.js";

const budget = {
  max_candidate_queries: 2,
  max_source_fetches: 2,
  max_semantic_evaluations: 2,
  max_contradiction_queries: 2,
  latency_budget_ms: 10_000,
  hard_cost_ceiling_usd: 1
};

{
  const events = [];
  const executor = createEvidenceExecutor({
    execution_budget: budget,
    emit: (event) => events.push(event),
    providers: {
      SOURCE_FETCH: async () => ({ actual_cost_usd: 0.1, value: { ok: true } })
    }
  });

  const result = await executor.run({
    kind: "SOURCE_FETCH",
    idempotency_key: "source:success",
    reserve_cost_usd: 0.2,
    request: { url: "https://example.com" }
  });

  assert.equal(result.status, "COMPLETED");
  assert.deepEqual(result.value, { ok: true });
  assert.equal(result.reservation.status, "SETTLED");
  assert.equal(result.reservation.actual_cost_usd, 0.1);
  assert.equal(executor.snapshot().closed, false);
  assert.equal(events.at(-1)?.type, "EVIDENCE_ACTION_SETTLED");
}

{
  const events = [];
  const executor = createEvidenceExecutor({
    execution_budget: budget,
    emit: (event) => events.push(event),
    providers: {
      SOURCE_FETCH: async () => ({ actual_cost_usd: 0.3, value: { should_not_escape: true } })
    }
  });

  const result = await executor.run({
    kind: "SOURCE_FETCH",
    idempotency_key: "source:overage",
    reserve_cost_usd: 0.2
  });

  assert.equal(result.status, "FAILED");
  assert.equal(result.value, null);
  assert.equal(result.error_code, "evidence_provider_actual_cost_exceeds_reservation");
  assert.equal(result.reservation.status, "SETTLED");
  assert.equal(result.reservation.actual_cost_usd, 0.2);
  assert.equal(result.reservation.outcome, "PROVIDER_ACCOUNTING_INVALID");
  assert.equal(executor.snapshot().reserved_cost_usd, 0);
  assert.equal(executor.snapshot().actual_cost_usd, 0.2);
  assert.equal(executor.snapshot().closed, true);
  assert.equal(executor.snapshot().close_reason, "evidence_provider_actual_cost_exceeds_reservation");
  assert.equal(events.some((event) => event.type === "EVIDENCE_BUDGET_CLOSED"), true);

  const denied = await executor.run({
    kind: "SOURCE_FETCH",
    idempotency_key: "source:after-overage",
    reserve_cost_usd: 0.1
  });
  assert.equal(denied.status, "DENIED");
  assert.match(denied.denial.code, /^BUDGET_CLOSED:/);
}

{
  const executor = createEvidenceExecutor({
    execution_budget: budget,
    providers: {
      SEMANTIC_EVALUATION: async () => ({ actual_cost_usd: "not-a-number", value: { verdict: "SUPPORTED" } })
    }
  });

  const result = await executor.run({
    kind: "SEMANTIC_EVALUATION",
    idempotency_key: "semantic:invalid-cost",
    reserve_cost_usd: 0.25
  });

  assert.equal(result.status, "FAILED");
  assert.equal(result.value, null);
  assert.equal(result.error_code, "evidence_provider_actual_cost_invalid");
  assert.equal(result.reservation.status, "SETTLED");
  assert.equal(result.reservation.actual_cost_usd, 0.25);
  assert.equal(executor.snapshot().closed, true);
}

{
  const executor = createEvidenceExecutor({
    execution_budget: budget,
    providers: {
      CONTRADICTION_QUERY: async () => {
        const error = new Error("provider timed out");
        error.code = "ETIMEDOUT";
        throw error;
      }
    }
  });

  const result = await executor.run({
    kind: "CONTRADICTION_QUERY",
    idempotency_key: "contradiction:timeout",
    reserve_cost_usd: 0.15
  });

  assert.equal(result.status, "FAILED");
  assert.equal(result.error_code, "ETIMEDOUT");
  assert.equal(result.reservation.outcome, "TIMEOUT");
  assert.equal(result.reservation.actual_cost_usd, 0.15);
  assert.equal(executor.snapshot().closed, false);
}

{
  const executor = createEvidenceExecutor({
    execution_budget: budget,
    providers: {
      CANDIDATE_QUERY: async () => {
        const error = new Error("provider failed after overspend");
        error.code = "UPSTREAM_FAILED";
        error.actual_cost_usd = 0.4;
        throw error;
      }
    }
  });

  const result = await executor.run({
    kind: "CANDIDATE_QUERY",
    idempotency_key: "candidate:thrown-overage",
    reserve_cost_usd: 0.1
  });

  assert.equal(result.status, "FAILED");
  assert.equal(result.error_code, "evidence_provider_actual_cost_exceeds_reservation");
  assert.equal(result.reservation.status, "SETTLED");
  assert.equal(result.reservation.actual_cost_usd, 0.1);
  assert.equal(result.reservation.outcome, "PROVIDER_ACCOUNTING_INVALID");
  assert.equal(executor.snapshot().closed, true);
  assert.equal(executor.snapshot().close_reason, "evidence_provider_actual_cost_exceeds_reservation");
}

{
  let nowMs = 1000;
  let providerCalls = 0;
  const events = [];
  const executor = createEvidenceExecutor({
    execution_budget: { ...budget, latency_budget_ms: 50 },
    now: () => nowMs,
    emit: (event) => events.push(event),
    providers: {
      SOURCE_FETCH: async () => {
        providerCalls += 1;
        return { actual_cost_usd: 0.01, value: { should_not_run: true } };
      }
    }
  });

  nowMs = 1050;
  const result = await executor.run({
    kind: "SOURCE_FETCH",
    idempotency_key: "source:expired-before-start",
    reserve_cost_usd: 0.1
  });

  assert.equal(result.status, "DENIED");
  assert.equal(result.value, null);
  assert.equal(result.denial.code, "BUDGET_CLOSED:evidence_latency_budget_exceeded");
  assert.equal(providerCalls, 0);
  assert.equal(executor.snapshot().closed, true);
  assert.equal(executor.snapshot().close_reason, "evidence_latency_budget_exceeded");
  assert.equal(events.some((event) => event.type === "EVIDENCE_BUDGET_CLOSED"), true);
}

{
  const events = [];
  let observedSignal = null;
  const executor = createEvidenceExecutor({
    execution_budget: { ...budget, latency_budget_ms: 15 },
    emit: (event) => events.push(event),
    providers: {
      CONTRADICTION_QUERY: async ({ signal }) => {
        observedSignal = signal;
        await new Promise((resolve) => setTimeout(resolve, 50));
        return { actual_cost_usd: 0.01, value: { late: true } };
      }
    }
  });

  const result = await executor.run({
    kind: "CONTRADICTION_QUERY",
    idempotency_key: "contradiction:deadline-race",
    reserve_cost_usd: 0.1
  });

  assert.equal(result.status, "FAILED");
  assert.equal(result.value, null);
  assert.equal(result.error_code, "evidence_latency_budget_exceeded");
  assert.equal(result.reservation.status, "SETTLED");
  assert.equal(result.reservation.outcome, "TIMEOUT");
  assert.equal(result.reservation.actual_cost_usd, 0.1);
  assert.equal(observedSignal?.aborted, true);
  assert.equal(executor.snapshot().closed, true);
  assert.equal(executor.snapshot().close_reason, "evidence_latency_budget_exceeded");
  assert.equal(events.some((event) => event.type === "EVIDENCE_BUDGET_CLOSED"), true);
}

for (const [label, providerResult] of [
  ["null", null],
  ["primitive", "ok"],
  ["missing-value", { actual_cost_usd: 0.01 }]
]) {
  const executor = createEvidenceExecutor({
    execution_budget: budget,
    providers: {
      CANDIDATE_QUERY: async () => providerResult
    }
  });

  const result = await executor.run({
    kind: "CANDIDATE_QUERY",
    idempotency_key: `candidate:malformed-result:${label}`,
    reserve_cost_usd: 0.1
  });

  assert.equal(result.status, "FAILED");
  assert.equal(result.value, null);
  assert.equal(result.error_code, "evidence_provider_result_invalid");
  assert.equal(result.reservation.status, "SETTLED");
  assert.equal(result.reservation.outcome, "PROVIDER_ACCOUNTING_INVALID");
  assert.equal(result.reservation.actual_cost_usd, 0.1);
  assert.equal(executor.snapshot().closed, true);
  assert.equal(executor.snapshot().close_reason, "evidence_provider_result_invalid");
}

{
  const executor = createEvidenceExecutor({
    execution_budget: budget,
    providers: {
      CANDIDATE_QUERY: async () => ({ actual_cost_usd: 0, value: null })
    }
  });

  const result = await executor.run({
    kind: "CANDIDATE_QUERY",
    idempotency_key: "candidate:explicit-null-value",
    reserve_cost_usd: 0.1
  });

  assert.equal(result.status, "COMPLETED");
  assert.equal(result.value, null);
  assert.equal(result.reservation.outcome, "COMPLETED");
  assert.equal(executor.snapshot().closed, false);
}

console.log("evidence executor tests passed");
