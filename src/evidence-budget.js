const BUDGET_STATE_VERSION = "proofttl-evidence-budget-state-v1";

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
    reserved_cost_usd: 0,
    actual_cost_usd: 0,
    closed: false,
    close_reason: null
  };
}

export function reserveEvidenceAction(state, action) {
  validateState(state);
  if (state.closed) throw new Error(`evidence_budget_closed:${state.close_reason || "UNKNOWN"}`);

  const kind = normalizeActionKind(action?.kind);
  const field = ACTION_LIMIT_FIELD[kind];
  const nextCount = state.used[field] + 1;
  const countCeiling = state.ceiling[field];
  if (nextCount > countCeiling) throw new Error(`evidence_budget_${field}_exceeded`);

  const reserveUsd = finiteUsd(action?.reserve_cost_usd, "reserve_cost_usd");
  const costCeiling = state.ceiling.hard_cost_ceiling_usd;
  const nextReserved = roundUsd(state.reserved_cost_usd + reserveUsd);
  if (nextReserved > costCeiling) throw new Error("evidence_budget_hard_cost_ceiling_exceeded");

  return {
    ...state,
    used: { ...state.used, [field]: nextCount },
    reserved_cost_usd: nextReserved
  };
}

export function settleEvidenceAction(state, settlement) {
  validateState(state);
  const reservedUsd = finiteUsd(settlement?.reserved_cost_usd, "reserved_cost_usd");
  const actualUsd = finiteUsd(settlement?.actual_cost_usd, "actual_cost_usd");
  if (reservedUsd > state.reserved_cost_usd) throw new Error("evidence_budget_settlement_exceeds_reserved");
  if (actualUsd > reservedUsd) throw new Error("evidence_budget_actual_exceeds_reservation");

  const nextReserved = roundUsd(state.reserved_cost_usd - reservedUsd);
  const nextActual = roundUsd(state.actual_cost_usd + actualUsd);
  if (nextActual + nextReserved > state.ceiling.hard_cost_ceiling_usd) {
    throw new Error("evidence_budget_hard_cost_ceiling_exceeded");
  }

  return { ...state, reserved_cost_usd: nextReserved, actual_cost_usd: nextActual };
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

function finiteUsd(value, field) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) throw new Error(`evidence_budget_invalid_${field}`);
  return roundUsd(number);
}

function roundUsd(value) {
  return Math.round(value * 1e12) / 1e12;
}
