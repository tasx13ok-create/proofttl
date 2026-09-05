const SUMMARY_VERSION = "proofttl-evidence-execution-summary-v1";
const PLAN_VERSION = "proofttl-evidence-plan-v1";
const DENIAL_VERSION = "proofttl-evidence-budget-denial-v1";
const RESULT_STATUSES = new Set(["COMPLETED", "FAILED", "DENIED", "ALREADY_SETTLED", "ALREADY_RESERVED"]);
const ACTION_LIMIT_FIELD = Object.freeze({
  CANDIDATE_QUERY: "max_candidate_queries",
  SOURCE_FETCH: "max_source_fetches",
  SEMANTIC_EVALUATION: "max_semantic_evaluations",
  CONTRADICTION_QUERY: "max_contradiction_queries"
});

export function summarizeEvidenceExecution({ evidence_plan, action_results = [] } = {}) {
  validatePlan(evidence_plan);
  if (!Array.isArray(action_results)) throw new Error("evidence_execution_action_results_required");

  if (evidence_plan.status !== "PLANNED") {
    return Object.freeze({
      version: SUMMARY_VERSION,
      execution_status: "NOT_EXECUTED",
      executed_action_count: 0,
      completed_action_count: 0,
      discovery_pass_required: false,
      discovery_pass_completed: false,
      source_fetch_required: false,
      source_fetch_completed: false,
      semantic_evaluation_required: false,
      semantic_evaluation_completed: false,
      contradiction_pass_required: false,
      contradiction_pass_completed: false,
      denials: [],
      failures: []
    });
  }

  const byKey = new Map();
  const denials = [];
  const failures = [];

  for (const result of action_results) {
    const normalized = normalizeActionResult(result);
    const existing = byKey.get(normalized.idempotency_key);
    if (existing) {
      if (!sameReceipt(existing, normalized)) throw new Error("evidence_execution_receipt_conflict");
      continue;
    }
    byKey.set(normalized.idempotency_key, normalized);
    if (normalized.denial) denials.push(normalized.denial);
    if (normalized.failure) failures.push(normalized.failure);
  }

  const receipts = [...byKey.values()];
  validateReceiptsAgainstPlan(evidence_plan, receipts);

  const executed = receipts.filter((receipt) => receipt.reservation?.status === "SETTLED");
  const completed = executed.filter((receipt) => receipt.reservation?.outcome === "COMPLETED");
  const discoveryRequired = requiresIndependentDiscovery(evidence_plan);
  const sourceFetchRequired = requiresBudgetedAction(evidence_plan, "max_source_fetches");
  const semanticEvaluationRequired = requiresBudgetedAction(evidence_plan, "max_semantic_evaluations");
  const discoveryCompleted = completed.some((receipt) => receipt.kind === "CANDIDATE_QUERY");
  const sourceFetchCompleted = completed.some((receipt) => receipt.kind === "SOURCE_FETCH");
  const semanticEvaluationCompleted = completed.some((receipt) => receipt.kind === "SEMANTIC_EVALUATION");
  const contradictionCompleted = completed.some((receipt) => receipt.kind === "CONTRADICTION_QUERY");
  const contradictionRequired = evidence_plan.contradiction_pass_required === true;

  const executionStatus = denials.length > 0
    ? "BUDGET_TRUNCATED"
    : failures.length > 0
      ? "EXECUTION_INCOMPLETE"
      : discoveryRequired && !discoveryCompleted
        ? "DISCOVERY_PASS_INCOMPLETE"
        : sourceFetchRequired && !sourceFetchCompleted
          ? "SOURCE_FETCH_INCOMPLETE"
          : semanticEvaluationRequired && !semanticEvaluationCompleted
            ? "SEMANTIC_EVALUATION_INCOMPLETE"
            : contradictionRequired && !contradictionCompleted
              ? "CONTRADICTION_PASS_INCOMPLETE"
              : receipts.length === 0
                ? "NOT_EXECUTED"
                : "COMPLETE";

  return Object.freeze({
    version: SUMMARY_VERSION,
    execution_status: executionStatus,
    executed_action_count: executed.length,
    completed_action_count: completed.length,
    discovery_pass_required: discoveryRequired,
    discovery_pass_completed: discoveryCompleted,
    source_fetch_required: sourceFetchRequired,
    source_fetch_completed: sourceFetchCompleted,
    semantic_evaluation_required: semanticEvaluationRequired,
    semantic_evaluation_completed: semanticEvaluationCompleted,
    contradiction_pass_required: contradictionRequired,
    contradiction_pass_completed: contradictionCompleted,
    denials: Object.freeze(denials),
    failures: Object.freeze(failures)
  });
}

function requiresIndependentDiscovery(plan) {
  if (plan.status !== "PLANNED") return false;
  const intents = Array.isArray(plan.query_intents) ? plan.query_intents : [];
  return intents.some((intent) => String(intent?.purpose || "").toUpperCase() !== "ADVERSARIAL_CONTRADICTION");
}

function requiresBudgetedAction(plan, field) {
  const budget = plan?.execution_budget;
  if (!budget || typeof budget !== "object" || Array.isArray(budget)) return false;
  const value = Number(budget[field]);
  return Number.isInteger(value) && value > 0;
}

function normalizeActionResult(result) {
  if (!result || typeof result !== "object" || Array.isArray(result)) {
    throw new Error("evidence_execution_receipt_invalid");
  }

  const status = String(result.status || "").toUpperCase();
  if (!RESULT_STATUSES.has(status)) throw new Error("evidence_execution_receipt_status_invalid");

  const reservation = result.reservation == null
    ? null
    : result.reservation && typeof result.reservation === "object" && !Array.isArray(result.reservation)
      ? result.reservation
      : invalid("evidence_execution_reservation_invalid");
  const denial = result.denial == null
    ? null
    : result.denial && typeof result.denial === "object" && !Array.isArray(result.denial)
      ? result.denial
      : invalid("evidence_execution_denial_invalid");

  if (reservation && denial) throw new Error("evidence_execution_receipt_mixed_outcome");

  validateReceiptCoherence(status, reservation, denial);

  const key = String(reservation?.idempotency_key || denial?.idempotency_key || "").trim();
  const kind = String(reservation?.kind || denial?.kind || "").toUpperCase();
  if (!key || !kind) throw new Error("evidence_execution_receipt_identity_required");
  if (!ACTION_LIMIT_FIELD[kind]) throw new Error("evidence_execution_receipt_kind_unsupported");

  const failure = reservation?.status === "RESERVED"
    ? Object.freeze({ kind, idempotency_key: key, outcome: "UNSETTLED" })
    : reservation?.status === "SETTLED" && reservation?.outcome !== "COMPLETED"
      ? Object.freeze({
          kind,
          idempotency_key: key,
          outcome: String(reservation?.outcome || result.error_code || "FAILED")
        })
      : null;

  return Object.freeze({
    idempotency_key: key,
    kind,
    status,
    reservation,
    denial,
    failure
  });
}

function validateReceiptCoherence(status, reservation, denial) {
  if (status === "DENIED") {
    if (reservation || !denial) throw new Error("evidence_execution_denied_receipt_invalid");
    if (denial.version !== DENIAL_VERSION) throw new Error("evidence_execution_denial_version_invalid");
    return;
  }

  if (denial || !reservation) throw new Error("evidence_execution_reservation_required");

  const reservationStatus = String(reservation.status || "").toUpperCase();
  const outcome = String(reservation.outcome || "").toUpperCase();
  if (!["RESERVED", "SETTLED"].includes(reservationStatus)) {
    throw new Error("evidence_execution_reservation_status_invalid");
  }

  if (status === "COMPLETED") {
    if (reservationStatus !== "SETTLED" || outcome !== "COMPLETED") {
      throw new Error("evidence_execution_completed_receipt_incoherent");
    }
    return;
  }

  if (status === "FAILED") {
    if (reservationStatus !== "SETTLED" || !outcome || outcome === "COMPLETED") {
      throw new Error("evidence_execution_failed_receipt_incoherent");
    }
    return;
  }

  if (status === "ALREADY_SETTLED") {
    if (reservationStatus !== "SETTLED" || !outcome) {
      throw new Error("evidence_execution_settled_replay_incoherent");
    }
    return;
  }

  if (status === "ALREADY_RESERVED" && reservationStatus !== "RESERVED") {
    throw new Error("evidence_execution_reserved_replay_incoherent");
  }
}

function validateReceiptsAgainstPlan(plan, receipts) {
  const budget = plan.execution_budget;
  if (receipts.length === 0 || budget == null) return;
  if (!budget || typeof budget !== "object" || Array.isArray(budget)) {
    throw new Error("evidence_execution_plan_budget_invalid");
  }

  const reservedCounts = Object.fromEntries(Object.keys(ACTION_LIMIT_FIELD).map((kind) => [kind, 0]));
  for (const receipt of receipts) {
    if (!receipt.reservation) continue;
    reservedCounts[receipt.kind] += 1;
  }

  for (const [kind, field] of Object.entries(ACTION_LIMIT_FIELD)) {
    const limit = Number(budget[field]);
    if (!Number.isInteger(limit) || limit < 0) {
      throw new Error(`evidence_execution_plan_budget_invalid_${field}`);
    }
    if (reservedCounts[kind] > limit) {
      throw new Error(`evidence_execution_receipts_exceed_plan_${field}`);
    }
  }
}

function sameReceipt(a, b) {
  return a.kind === b.kind
    && a.status === b.status
    && stable(a.reservation) === stable(b.reservation)
    && stable(a.denial) === stable(b.denial);
}

function stable(value) {
  return JSON.stringify(canonicalize(value));
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, canonicalize(value[key])])
  );
}

function validatePlan(plan) {
  if (!plan || typeof plan !== "object" || plan.version !== PLAN_VERSION) {
    throw new Error("evidence_execution_plan_required");
  }
}

function invalid(code) {
  throw new Error(code);
}
