const SUMMARY_VERSION = "proofttl-evidence-execution-summary-v1";
const PLAN_VERSION = "proofttl-evidence-plan-v1";

export function summarizeEvidenceExecution({ evidence_plan, action_results = [] } = {}) {
  validatePlan(evidence_plan);
  if (!Array.isArray(action_results)) throw new Error("evidence_execution_action_results_required");

  if (evidence_plan.status !== "PLANNED") {
    return Object.freeze({
      version: SUMMARY_VERSION,
      execution_status: "NOT_EXECUTED",
      executed_action_count: 0,
      completed_action_count: 0,
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
  const executed = receipts.filter((receipt) => receipt.reservation?.status === "SETTLED");
  const completed = executed.filter((receipt) => receipt.reservation?.outcome === "COMPLETED");
  const contradictionCompleted = completed.some((receipt) => receipt.kind === "CONTRADICTION_QUERY");
  const contradictionRequired = evidence_plan.contradiction_pass_required === true;

  const executionStatus = denials.length > 0
    ? "BUDGET_TRUNCATED"
    : failures.length > 0
      ? "EXECUTION_INCOMPLETE"
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
    contradiction_pass_required: contradictionRequired,
    contradiction_pass_completed: contradictionCompleted,
    denials: Object.freeze(denials),
    failures: Object.freeze(failures)
  });
}

function normalizeActionResult(result) {
  if (!result || typeof result !== "object" || Array.isArray(result)) {
    throw new Error("evidence_execution_receipt_invalid");
  }

  const reservation = result.reservation && typeof result.reservation === "object"
    ? result.reservation
    : null;
  const denial = result.denial && typeof result.denial === "object"
    ? result.denial
    : null;
  const key = String(reservation?.idempotency_key || denial?.idempotency_key || "").trim();
  const kind = String(reservation?.kind || denial?.kind || "").toUpperCase();

  if (!key || !kind) throw new Error("evidence_execution_receipt_identity_required");

  const failure = reservation?.status === "SETTLED" && reservation?.outcome !== "COMPLETED"
    ? Object.freeze({
        kind,
        idempotency_key: key,
        outcome: String(reservation?.outcome || result.error_code || "FAILED")
      })
    : null;

  return Object.freeze({
    idempotency_key: key,
    kind,
    status: String(result.status || ""),
    reservation,
    denial,
    failure
  });
}

function sameReceipt(a, b) {
  return a.kind === b.kind
    && a.status === b.status
    && stable(a.reservation) === stable(b.reservation)
    && stable(a.denial) === stable(b.denial);
}

function stable(value) {
  if (value == null) return "null";
  return JSON.stringify(value, Object.keys(value).sort());
}

function validatePlan(plan) {
  if (!plan || typeof plan !== "object" || plan.version !== PLAN_VERSION) {
    throw new Error("evidence_execution_plan_required");
  }
}
