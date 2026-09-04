import {
  attemptReserveEvidenceAction,
  closeEvidenceBudget,
  createEvidenceBudgetState,
  getEvidenceReservation,
  settleEvidenceActionConservatively
} from "./evidence-budget.js";

const EXECUTOR_VERSION = "proofttl-evidence-executor-v1";
const PROVIDER_KINDS = new Set(["CANDIDATE_QUERY", "SOURCE_FETCH", "SEMANTIC_EVALUATION", "CONTRADICTION_QUERY"]);

export function createEvidenceExecutor({ execution_budget, providers = {}, emit = null } = {}) {
  let state = createEvidenceBudgetState(execution_budget);
  const providerMap = normalizeProviders(providers);
  const emitEvent = typeof emit === "function" ? emit : () => {};

  async function run(action = {}) {
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
      result = await provider(Object.freeze({ grant: attempt.grant, request: action.request ?? null }));
    } catch (error) {
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

  return Object.freeze({ version: EXECUTOR_VERSION, run, snapshot: () => state });
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
