import {
  attemptReserveEvidenceAction,
  closeEvidenceBudget,
  createEvidenceBudgetState,
  getEvidenceReservation,
  settleEvidenceActionConservatively
} from "./evidence-budget.js";

const EXECUTOR_VERSION = "proofttl-evidence-executor-v1";
const PROVIDER_KINDS = new Set(["CANDIDATE_QUERY", "SOURCE_FETCH", "SEMANTIC_EVALUATION", "CONTRADICTION_QUERY"]);
const LATENCY_ERROR_CODE = "evidence_latency_budget_exceeded";

export function createEvidenceExecutor({ execution_budget, providers = {}, emit = null, now = Date.now } = {}) {
  let state = createEvidenceBudgetState(execution_budget);
  const providerMap = normalizeProviders(providers);
  const emitEvent = typeof emit === "function" ? emit : () => {};
  const clock = typeof now === "function" ? now : Date.now;
  const startedAtMs = finiteClock(clock());
  const latencyBudgetMs = Math.max(0, Number(state.ceiling.latency_budget_ms) || 0);
  const deadlineMs = startedAtMs + latencyBudgetMs;

  async function run(action = {}) {
    if (latencyExceeded()) {
      return denyForLatency(action);
    }

    const attempt = attemptReserveEvidenceAction(state, action);
    state = attempt.state;

    if (!attempt.granted) {
      emitEvent({ version: EXECUTOR_VERSION, type: "EVIDENCE_BUDGET_DENIED", denial: attempt.denial });
      return { status: "DENIED", denial: attempt.denial, reservation: null, value: null };
    }

    if (attempt.replay) {
      const reservation = getEvidenceReservation(state, attempt.grant.idempotency_key);
      emitEvent({ version: EXECUTOR_VERSION, type: "EVIDENCE_ACTION_REPLAY_BLOCKED", reservation });
      return {
        status: reservation.status === "SETTLED" ? "ALREADY_SETTLED" : "ALREADY_RESERVED",
        denial: null,
        reservation,
        value: null
      };
    }

    if (latencyExceeded()) {
      return failForLatency(attempt.grant);
    }

    const provider = providerMap[attempt.grant.kind];
    if (!provider) {
      state = settleEvidenceActionConservatively(state, {
        idempotency_key: attempt.grant.idempotency_key,
        outcome: "PROVIDER_UNAVAILABLE"
      });
      const reservation = getEvidenceReservation(state, attempt.grant.idempotency_key);
      emitEvent({ version: EXECUTOR_VERSION, type: "EVIDENCE_ACTION_SETTLED", reservation });
      return { status: "FAILED", denial: null, reservation, value: null, error_code: "evidence_provider_unavailable" };
    }

    let result;
    try {
      result = await runProviderWithinDeadline(provider, attempt.grant, action.request ?? null);
    } catch (error) {
      if (error?.code === LATENCY_ERROR_CODE) {
        return failForLatency(attempt.grant);
      }

      const failureCost = finiteOptionalCost(error?.actual_cost_usd);
      if (error?.actual_cost_usd != null && failureCost == null) {
        return failClosedSettlement(attempt.grant, "evidence_provider_actual_cost_invalid");
      }
      if (failureCost != null && failureCost > attempt.grant.reserved_cost_usd) {
        return failClosedSettlement(attempt.grant, "evidence_provider_actual_cost_exceeds_reservation");
      }

      state = settleEvidenceActionConservatively(state, {
        idempotency_key: attempt.grant.idempotency_key,
        actual_cost_usd: failureCost,
        outcome: classifyFailure(error)
      });
      const reservation = getEvidenceReservation(state, attempt.grant.idempotency_key);
      emitEvent({
        version: EXECUTOR_VERSION,
        type: "EVIDENCE_ACTION_SETTLED",
        reservation,
        error_code: cleanErrorCode(error)
      });
      return {
        status: "FAILED",
        denial: null,
        reservation,
        value: null,
        error_code: cleanErrorCode(error)
      };
    }

    if (latencyExceeded()) {
      return failForLatency(attempt.grant);
    }

    const providerCost = finiteOptionalCost(result?.actual_cost_usd);
    if (result?.actual_cost_usd != null && providerCost == null) {
      return failClosedSettlement(attempt.grant, "evidence_provider_actual_cost_invalid");
    }
    if (providerCost != null && providerCost > attempt.grant.reserved_cost_usd) {
      return failClosedSettlement(attempt.grant, "evidence_provider_actual_cost_exceeds_reservation");
    }

    state = settleEvidenceActionConservatively(state, {
      idempotency_key: attempt.grant.idempotency_key,
      actual_cost_usd: providerCost,
      outcome: "COMPLETED"
    });
    const reservation = getEvidenceReservation(state, attempt.grant.idempotency_key);
    emitEvent({ version: EXECUTOR_VERSION, type: "EVIDENCE_ACTION_SETTLED", reservation });
    return { status: "COMPLETED", denial: null, reservation, value: result?.value ?? null };
  }

  async function runProviderWithinDeadline(provider, grant, request) {
    const remainingMs = deadlineMs - finiteClock(clock());
    if (remainingMs <= 0) throw latencyError();

    const controller = new AbortController();
    let timer = null;
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => {
        controller.abort(LATENCY_ERROR_CODE);
        reject(latencyError());
      }, remainingMs);
    });

    try {
      return await Promise.race([
        Promise.resolve(provider(Object.freeze({
          grant,
          request,
          signal: controller.signal,
          deadline_ms: deadlineMs
        }))),
        timeout
      ]);
    } finally {
      if (timer !== null) clearTimeout(timer);
    }
  }

  function latencyExceeded() {
    return finiteClock(clock()) >= deadlineMs;
  }

  function denyForLatency(action) {
    if (!state.closed) {
      state = closeEvidenceBudget(state, LATENCY_ERROR_CODE);
      emitEvent({
        version: EXECUTOR_VERSION,
        type: "EVIDENCE_BUDGET_CLOSED",
        reason: LATENCY_ERROR_CODE
      });
    }

    const denial = Object.freeze({
      version: "proofttl-evidence-budget-denial-v1",
      code: `BUDGET_CLOSED:${LATENCY_ERROR_CODE}`,
      kind: String(action?.kind || "").toUpperCase() || null,
      idempotency_key: String(action?.idempotency_key || "").trim() || null,
      reserve_cost_usd: finiteOptionalCost(action?.reserve_cost_usd),
      remaining_latency_ms: 0
    });
    emitEvent({ version: EXECUTOR_VERSION, type: "EVIDENCE_BUDGET_DENIED", denial });
    return { status: "DENIED", denial, reservation: null, value: null };
  }

  function failForLatency(grant) {
    state = settleEvidenceActionConservatively(state, {
      idempotency_key: grant.idempotency_key,
      outcome: "TIMEOUT"
    });
    state = closeEvidenceBudget(state, LATENCY_ERROR_CODE);
    const reservation = getEvidenceReservation(state, grant.idempotency_key);
    emitEvent({
      version: EXECUTOR_VERSION,
      type: "EVIDENCE_ACTION_SETTLED",
      reservation,
      error_code: LATENCY_ERROR_CODE
    });
    emitEvent({
      version: EXECUTOR_VERSION,
      type: "EVIDENCE_BUDGET_CLOSED",
      reason: LATENCY_ERROR_CODE
    });
    return {
      status: "FAILED",
      denial: null,
      reservation,
      value: null,
      error_code: LATENCY_ERROR_CODE
    };
  }

  function failClosedSettlement(grant, errorCode) {
    state = settleEvidenceActionConservatively(state, {
      idempotency_key: grant.idempotency_key,
      outcome: "PROVIDER_ACCOUNTING_INVALID"
    });
    state = closeEvidenceBudget(state, errorCode);
    const reservation = getEvidenceReservation(state, grant.idempotency_key);
    emitEvent({
      version: EXECUTOR_VERSION,
      type: "EVIDENCE_ACTION_SETTLED",
      reservation,
      error_code: errorCode
    });
    emitEvent({
      version: EXECUTOR_VERSION,
      type: "EVIDENCE_BUDGET_CLOSED",
      reason: errorCode
    });
    return {
      status: "FAILED",
      denial: null,
      reservation,
      value: null,
      error_code: errorCode
    };
  }

  return Object.freeze({
    version: EXECUTOR_VERSION,
    run,
    snapshot: () => state,
    timing: () => Object.freeze({ started_at_ms: startedAtMs, deadline_ms: deadlineMs, latency_budget_ms: latencyBudgetMs })
  });
}

function normalizeProviders(providers) {
  const normalized = {};
  for (const kind of PROVIDER_KINDS) {
    const provider = providers[kind];
    if (provider != null && typeof provider !== "function") throw new Error(`evidence_provider_invalid:${kind}`);
    if (typeof provider === "function") normalized[kind] = provider;
  }
  return Object.freeze(normalized);
}

function finiteOptionalCost(value) {
  if (value == null) return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function classifyFailure(error) {
  const code = String(error?.code || error?.name || "FAILED").toUpperCase();
  if (code.includes("TIMEOUT") || code.includes("TIMEDOUT")) return "TIMEOUT";
  if (code.includes("ABORT") || code.includes("CANCEL")) return "CANCELLED";
  return "FAILED";
}

function cleanErrorCode(error) {
  return String(error?.code || error?.name || "evidence_action_failed").slice(0, 120);
}

function finiteClock(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error("evidence_executor_clock_invalid");
  return number;
}

function latencyError() {
  const error = new Error(LATENCY_ERROR_CODE);
  error.code = LATENCY_ERROR_CODE;
  return error;
}
