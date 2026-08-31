const BUDGET_STATE_VERSION = "proofttl-evidence-budget-state-v2";

const ACTION_LIMIT_FIELD = Object.freeze({
  CANDIDATE_QUERY: "max_candidate_queries",
  SOURCE_FETCH: "max_source_fetches",
  SEMANTIC_EVALUATION: "max_semantic_evaluations",
  CONTRADICTION_QUERY: "max_contradiction_queries"
});

export function createEvidenceBudgetState(executionBudget) {
  validateExecutionBudget(executionBudget);
  return {
    version: BUDGET_STATE_VERSION,
    ceiling: normalizeBudget(executionBudget),
    used: emptyUsage(),
    reservations: {},
    reserved_cost_usd: 0,
    actual_cost_usd: 0,
    closed: false,
    close_reason: null
  };
}

export function attemptReserveEvidenceAction(state, action) {
  validateState(state);
  const kind = normalizeActionKind(action?.kind);
  const idempotencyKey = normalizeIdempotencyKey(action?.idempotency_key);
  const reserveUsd = finiteUsd(action?.reserve_cost_usd, "reserve_cost_usd");
  const existing = state.reservations[idempotencyKey];

  if (existing) {
    if (existing.kind !== kind || existing.reserved_cost_usd !== reserveUsd) {
      return denied(state, "IDEMPOTENCY_CONFLICT", kind, idempotencyKey, reserveUsd);
    }
    return { state, granted: true, replay: true, grant: reservationGrant(existing), denial: null };
  }

  if (state.closed) return denied(state, `BUDGET_CLOSED:${state.close_reason || "UNKNOWN"}`, kind, idempotencyKey, reserveUsd);

  const field = ACTION_LIMIT_FIELD[kind];
  const nextCount = state.used[field] + 1;
  if (nextCount > state.ceiling[field]) return denied(state, field.toUpperCase() + "_EXCEEDED", kind, idempotencyKey, reserveUsd);

  const nextReserved = roundUsd(state.reserved_cost_usd + reserveUsd);
  const committedCost = roundUsd(state.actual_cost_usd + nextReserved);
  if (committedCost > state.ceiling.hard_cost_ceiling_usd) {
    return denied(state, "HARD_COST_CEILING_EXCEEDED", kind, idempotencyKey, reserveUsd);
  }

  const reservation = Object.freeze({
    idempotency_key: idempotencyKey,
    kind,
    reserved_cost_usd: reserveUsd,
    actual_cost_usd: null,
    status: "RESERVED",
    outcome: null
  });

  const nextState = {
    ...state,
    used: { ...state.used, [field]: nextCount },
    reservations: { ...state.reservations, [idempotencyKey]: reservation },
    reserved_cost_usd: nextReserved
  };

  return { state: nextState, granted: true, replay: false, grant: reservationGrant(reservation), denial: null };
}

export function reserveEvidenceAction(state, action) {
  const attempt = attemptReserveEvidenceAction(state, action);
  if (!attempt.granted) throw new Error(`evidence_budget_${normalizeDenialForError(attempt.denial.code)}`);
  return attempt.state;
}

export function settleEvidenceAction(state, settlement) {
  validateState(state);
  const idempotencyKey = normalizeIdempotencyKey(settlement?.idempotency_key);
  const reservation = state.reservations[idempotencyKey];
  if (!reservation) throw new Error("evidence_budget_reservation_not_found");

  if (reservation.status === "SETTLED") {
    const requestedActual = finiteUsd(settlement?.actual_cost_usd, "actual_cost_usd");
    if (requestedActual !== reservation.actual_cost_usd) throw new Error("evidence_budget_settlement_conflict");
    return state;
  }

  const actualUsd = finiteUsd(settlement?.actual_cost_usd, "actual_cost_usd");
  if (actualUsd > reservation.reserved_cost_usd) throw new Error("evidence_budget_actual_exceeds_reservation");

  const nextReserved = roundUsd(state.reserved_cost_usd - reservation.reserved_cost_usd);
  const nextActual = roundUsd(state.actual_cost_usd + actualUsd);
  if (nextActual + nextReserved > state.ceiling.hard_cost_ceiling_usd) {
    throw new Error("evidence_budget_hard_cost_ceiling_exceeded");
  }

  const settled = Object.freeze({
    ...reservation,
    actual_cost_usd: actualUsd,
    status: "SETTLED",
    outcome: normalizeOutcome(settlement?.outcome)
  });

  return {
    ...state,
    reservations: { ...state.reservations, [idempotencyKey]: settled },
    reserved_cost_usd: nextReserved,
    actual_cost_usd: nextActual
  };
}

export function settleEvidenceActionConservatively(state, settlement) {
  validateState(state);
  const idempotencyKey = normalizeIdempotencyKey(settlement?.idempotency_key);
  const reservation = state.reservations[idempotencyKey];
  if (!reservation) throw new Error("evidence_budget_reservation_not_found");
  const actualCost = settlement?.actual_cost_usd == null
    ? reservation.reserved_cost_usd
    : finiteUsd(settlement.actual_cost_usd, "actual_cost_usd");
  return settleEvidenceAction(state, {
    idempotency_key: idempotencyKey,
    actual_cost_usd: actualCost,
    outcome: settlement?.outcome || "FAILED"
  });
}

export function getEvidenceReservation(state, idempotencyKey) {
  validateState(state);
  const key = normalizeIdempotencyKey(idempotencyKey);
  return state.reservations[key] || null;
}

export function closeEvidenceBudget(state, reason = "COMPLETED") {
  validateState(state);
  return { ...state, closed: true, close_reason: String(reason || "COMPLETED") };
}

export function evidenceBudgetRemaining(state) {
  validateState(state);
  return {
    candidate_queries: Math.max(0, state.ceiling.max_candidate_queries - state.used.max_candidate_queries),
    source_fetches: Math.max(0, state.ceiling.max_source_fetches - state.used.max_source_fetches),
    semantic_evaluations: Math.max(0, state.ceiling.max_semantic_evaluations - state.used.max_semantic_evaluations),
    contradiction_queries: Math.max(0, state.ceiling.max_contradiction_queries - state.used.max_contradiction_queries),
    cost_usd: roundUsd(Math.max(0, state.ceiling.hard_cost_ceiling_usd - state.actual_cost_usd - state.reserved_cost_usd))
  };
}

function denied(state, code, kind, idempotencyKey, reserveUsd) {
  return {
    state,
    granted: false,
    replay: false,
    grant: null,
    denial: Object.freeze({
      version: "proofttl-evidence-budget-denial-v1",
      code,
      kind,
      idempotency_key: idempotencyKey,
      reserve_cost_usd: reserveUsd,
      remaining: evidenceBudgetRemaining(state)
    })
  };
}

function reservationGrant(reservation) {
  return Object.freeze({
    version: "proofttl-evidence-reservation-grant-v1",
    idempotency_key: reservation.idempotency_key,
    kind: reservation.kind,
    reserved_cost_usd: reservation.reserved_cost_usd,
    status: reservation.status
  });
}

function validateExecutionBudget(budget) {
  if (!budget || typeof budget !== "object") throw new Error("evidence_budget_required");
  for (const field of Object.values(ACTION_LIMIT_FIELD)) {
    const value = Number(budget[field]);
    if (!Number.isInteger(value) || value < 0) throw new Error(`evidence_budget_invalid_${field}`);
  }
  const cost = Number(budget.hard_cost_ceiling_usd);
  if (!Number.isFinite(cost) || cost < 0) throw new Error("evidence_budget_hard_cost_ceiling_required");
}

function validateState(state) {
  if (!state || state.version !== BUDGET_STATE_VERSION) throw new Error("evidence_budget_state_required");
  validateExecutionBudget(state.ceiling);
  if (!state.reservations || typeof state.reservations !== "object") throw new Error("evidence_budget_reservations_required");
}

function normalizeBudget(budget) {
  return {
    max_candidate_queries: Number(budget.max_candidate_queries),
    max_source_fetches: Number(budget.max_source_fetches),
    max_semantic_evaluations: Number(budget.max_semantic_evaluations),
    max_contradiction_queries: Number(budget.max_contradiction_queries),
    latency_budget_ms: Math.max(0, Number(budget.latency_budget_ms) || 0),
    hard_cost_ceiling_usd: roundUsd(Number(budget.hard_cost_ceiling_usd))
  };
}

function emptyUsage() {
  return {
    max_candidate_queries: 0,
    max_source_fetches: 0,
    max_semantic_evaluations: 0,
    max_contradiction_queries: 0
  };
}

function normalizeActionKind(value) {
  const kind = String(value || "").toUpperCase();
  if (!ACTION_LIMIT_FIELD[kind]) throw new Error("evidence_budget_action_kind_unsupported");
  return kind;
}

function normalizeIdempotencyKey(value) {
  const key = String(value || "").trim();
  if (!key || key.length > 240) throw new Error("evidence_budget_idempotency_key_required");
  return key;
}

function normalizeOutcome(value) {
  const outcome = String(value || "COMPLETED").trim().toUpperCase();
  return outcome.slice(0, 80) || "COMPLETED";
}

function finiteUsd(value, field) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) throw new Error(`evidence_budget_invalid_${field}`);
  return roundUsd(number);
}

function normalizeDenialForError(code) {
  return String(code || "denied").toLowerCase().replace(/[^a-z0-9:_-]+/g, "_");
}

function roundUsd(value) {
  return Math.round(value * 1e12) / 1e12;
}
