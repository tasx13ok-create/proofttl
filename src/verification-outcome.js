const OUTCOME_VERSION = "proofttl-verification-outcome-v1";

export function finalizeVerificationOutcome({ evidence_ledger, execution = {} } = {}) {
  if (!evidence_ledger || evidence_ledger.version !== "proofttl-evidence-ledger-v1") {
    throw new Error("verification_outcome_evidence_ledger_required");
  }

  const denials = normalizeDenials(execution.denials);
  const failures = normalizeFailures(execution.failures);
  const contradictionRequired = execution.contradiction_pass_required === true;
  const contradictionCompleted = execution.contradiction_pass_completed === true;
  const budgetTruncated = denials.length > 0;
  const contradictionIncomplete = contradictionRequired && !contradictionCompleted;
  const executionFailed = failures.length > 0;
  const executionIncomplete = budgetTruncated || contradictionIncomplete || executionFailed;

  const evidenceVerdict = evidence_ledger.verdict;
  // A definitive verdict is only publishable when the planned verification
  // execution completed. Previously budget denials/provider failures withheld
  // confidence but could still leak a definitive evidence verdict as the final
  // verdict. That creates a split fail-closed contract: "execution incomplete"
  // beside SUPPORTED/CONTRADICTED. Preserve the evidence-level verdict for
  // auditability, but make the final verdict UNKNOWN until execution completes.
  const finalVerdict = executionIncomplete ? "UNKNOWN" : evidenceVerdict;
  const confidence = executionIncomplete ? null : evidence_ledger.confidence;

  return {
    version: OUTCOME_VERSION,
    verdict: finalVerdict,
    evidence_verdict: evidenceVerdict,
    confidence,
    evidence_confidence: evidence_ledger.confidence,
    execution_status: budgetTruncated
      ? "BUDGET_TRUNCATED"
      : contradictionIncomplete
        ? "CONTRADICTION_PASS_INCOMPLETE"
        : executionFailed
          ? "EXECUTION_INCOMPLETE"
          : "COMPLETE",
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
