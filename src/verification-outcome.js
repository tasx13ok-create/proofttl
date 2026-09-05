const OUTCOME_VERSION = "proofttl-verification-outcome-v1";
const EXECUTION_STATUSES = new Set([
  "COMPLETE",
  "NOT_EXECUTED",
  "BUDGET_TRUNCATED",
  "EXECUTION_INCOMPLETE",
  "DISCOVERY_PASS_INCOMPLETE",
  "SOURCE_FETCH_INCOMPLETE",
  "SEMANTIC_EVALUATION_INCOMPLETE",
  "CONTRADICTION_PASS_INCOMPLETE"
]);

export function finalizeVerificationOutcome({ evidence_ledger, execution = {} } = {}) {
  if (!evidence_ledger || evidence_ledger.version !== "proofttl-evidence-ledger-v1") {
    throw new Error("verification_outcome_evidence_ledger_required");
  }

  const denials = normalizeDenials(execution.denials);
  const failures = normalizeFailures(execution.failures);
  const contradictionRequired = execution.contradiction_pass_required === true;
  const contradictionCompleted = execution.contradiction_pass_completed === true;
  const declaredExecutionStatus = normalizeExecutionStatus(execution.execution_status);
  const budgetTruncated = denials.length > 0;
  const contradictionIncomplete = contradictionRequired && !contradictionCompleted;
  const executionFailed = failures.length > 0;
  const declaredIncomplete = declaredExecutionStatus != null && declaredExecutionStatus !== "COMPLETE";
  const executionIncomplete = budgetTruncated || contradictionIncomplete || executionFailed || declaredIncomplete;

  const evidenceVerdict = evidence_ledger.verdict;
  // A definitive verdict is only publishable when the planned verification
  // execution completed. Budget denials, provider failures, an unfinished
  // discovery/fetch/semantic/contradiction stage, or a receipt-derived
  // NOT_EXECUTED state all withhold the final verdict. Preserve the
  // evidence-level verdict for auditability.
  const finalVerdict = executionIncomplete ? "UNKNOWN" : evidenceVerdict;
  const confidence = executionIncomplete ? null : evidence_ledger.confidence;
  const finalExecutionStatus = budgetTruncated
    ? "BUDGET_TRUNCATED"
    : contradictionIncomplete
      ? "CONTRADICTION_PASS_INCOMPLETE"
      : executionFailed
        ? "EXECUTION_INCOMPLETE"
        : declaredIncomplete
          ? declaredExecutionStatus
          : "COMPLETE";

  return {
    version: OUTCOME_VERSION,
    verdict: finalVerdict,
    evidence_verdict: evidenceVerdict,
    confidence,
    evidence_confidence: evidence_ledger.confidence,
    execution_status: finalExecutionStatus,
    confidence_status: executionIncomplete ? "WITHHELD_EXECUTION_INCOMPLETE" : "REPORTABLE",
    contradiction_pass: {
      required: contradictionRequired,
      completed: contradictionCompleted
    },
    budget_denials: denials,
    execution_failures: failures,
    evidence_ledger
  };
}

function normalizeDenials(value) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item) => item && item.version === "proofttl-evidence-budget-denial-v1")
    .map((item) => ({
      code: String(item.code || "UNKNOWN"),
      kind: String(item.kind || "UNKNOWN"),
      idempotency_key: String(item.idempotency_key || "")
    }));
}

function normalizeFailures(value) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item) => item && typeof item === "object")
    .map((item) => ({
      kind: String(item.kind || "UNKNOWN"),
      idempotency_key: String(item.idempotency_key || ""),
      outcome: String(item.outcome || "FAILED")
    }));
}

function normalizeExecutionStatus(value) {
  if (value == null || value === "") return null;
  const normalized = String(value).toUpperCase();
  if (!EXECUTION_STATUSES.has(normalized)) throw new Error("verification_outcome_execution_status_invalid");
  return normalized;
}
