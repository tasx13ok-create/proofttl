import { aggregateEvidence } from "./evidence-quality.js";
import { summarizeEvidenceExecution } from "./evidence-execution-summary.js";
import { buildEvidencePlan, triageClaimContract } from "./verification-plan.js";
import { finalizeVerificationOutcome } from "./verification-outcome.js";

const OUTCOME_VERSION = "proofttl-verification-outcome-v1";

export function attachDerivedVerificationOutcome(lease) {
  if (!lease || typeof lease !== "object") return lease;
  if (lease.verification_outcome?.version === OUTCOME_VERSION) {
    alignLeaseWithOutcome(
      lease,
      lease.verification_outcome,
      lease.source_verdict || lease.verification_outcome.source_verdict || null
    );
    return lease;
  }
  if (!lease.claim_contract || !lease.source_url || !lease.status) return lease;

  const sourceVerdict = snapshotSourceVerdict(lease);
  const outcome = buildOutcomeFromSourceVerdict(lease, sourceVerdict, {
    final_url: lease.final_url || null,
    source_fingerprint: lease.source_fingerprint || null,
    observed_at: lease.observed_at || lease.issued_at || null
  });

  lease.verification_outcome = outcome;
  lease.source_verdict = sourceVerdict;
  alignLeaseWithOutcome(lease, outcome, sourceVerdict);
  return lease;
}

function alignLeaseWithOutcome(lease, outcome, sourceVerdict = null) {
  const verdict = normalizeVerdict(outcome?.verdict);
  const outcomeConfidence = Number.isFinite(Number(outcome?.confidence))
    ? Number(outcome.confidence)
    : 0;
  const sourceStatus = sourceVerdict?.status
    ? normalizeVerdict(sourceVerdict.status)
    : null;
  const outcomeReason = sourceStatus && verdict !== sourceStatus
    ? `verification_outcome:${outcome?.execution_status || "UNKNOWN"}`
    : null;
  const hasSignedIssuance = Boolean(lease?.issued_attestation && lease?.signature?.value);

  // status/current_status describe the authoritative present product verdict.
  // For ordinary/new leases, issuance aliases are kept aligned as well. A
  // legacy lease that already carries an issuance signature is different:
  // issued_status/confidence/reason/proof_basis are part of that immutable
  // signed attestation. Rewriting those mirrors would silently invalidate the
  // historical signature. Preserve its issuance truth, expose the corrected
  // final truth through status/current_* fields, and leave the stored
  // attestation byte-for-byte untouched.
  lease.status = verdict;
  lease.current_status = verdict;

  if (hasSignedIssuance) {
    lease.current_confidence = outcomeConfidence;
    if (outcomeReason) {
      lease.current_reason = outcomeReason;
      lease.current_proof_basis = "EVIDENCE_LEDGER";
    }
    return;
  }

  lease.issued_status = verdict;
  lease.confidence = outcomeConfidence;
  if (outcomeReason) {
    lease.reason = outcomeReason;
    lease.proof_basis = "EVIDENCE_LEDGER";
  }
}

export function deriveReverificationOutcome(lease, sourceVerdict, source = {}) {
  if (!lease || typeof lease !== "object") return null;
  if (!lease.claim_contract || !sourceVerdict || typeof sourceVerdict !== "object") return null;

  return buildOutcomeFromSourceVerdict(lease, normalizeSourceVerdict(sourceVerdict), {
    final_url: source.final_url || lease.final_url || lease.source_url || null,
    source_fingerprint: source.source_fingerprint || lease.last_source_fingerprint || lease.source_fingerprint || null,
    observed_at: source.observed_at || lease.last_observed_at || lease.observed_at || lease.issued_at || null
  });
}

// Integration boundary for the real evidence runtime. Providers/orchestration
// supply evidence items plus the executor's action results; this function
// derives execution truth only from those receipts and feeds it into the same
// fail-closed final-outcome primitive used by issuance/reverification.
export function deriveExecutedVerificationOutcome({
  claim_contract,
  evidence_items = [],
  action_results = [],
  triage = null,
  evidence_plan = null
} = {}) {
  if (!claim_contract || typeof claim_contract !== "object") {
    throw new Error("executed_verification_claim_contract_required");
  }
  if (!Array.isArray(evidence_items)) {
    throw new Error("executed_verification_evidence_items_required");
  }

  const resolvedTriage = triage || triageClaimContract(claim_contract);
  const resolvedPlan = evidence_plan || buildEvidencePlan(claim_contract, resolvedTriage);
  const executionSummary = summarizeEvidenceExecution({
    evidence_plan: resolvedPlan,
    action_results
  });
  const evidenceLedger = aggregateEvidence(evidence_items, { claim_contract });
  const outcome = finalizeVerificationOutcome({
    evidence_ledger: evidenceLedger,
    execution: {
      execution_status: executionSummary.execution_status,
      contradiction_pass_required: executionSummary.contradiction_pass_required,
      contradiction_pass_completed: executionSummary.contradiction_pass_completed,
      denials: executionSummary.denials,
      failures: executionSummary.failures
    }
  });

  outcome.triage = resolvedTriage;
  outcome.evidence_plan = resolvedPlan;
  outcome.execution_summary = executionSummary;
  return outcome;
}

function buildOutcomeFromSourceVerdict(lease, sourceVerdict, source) {
  const triage = triageClaimContract(lease.claim_contract);
  const evidencePlan = buildEvidencePlan(lease.claim_contract, triage);
  const evidenceLedger = aggregateEvidence(
    [evidenceItemFromLease(lease, sourceVerdict, source)],
    { claim_contract: lease.claim_contract }
  );

  const contradictionRequired = evidencePlan.contradiction_pass_required === true;
  const outcome = finalizeVerificationOutcome({
    evidence_ledger: evidenceLedger,
    execution: {
      // The public caller-source path does not execute the Evidence Plan.
      // This must be explicit even for low-assurance claims; otherwise the
      // finalizer defaults to COMPLETE and can publish a definitive verdict
      // while the adjacent signed evidence_plan truthfully says discovery was
      // not executed. Keep the source-level semantic result auditable, but
      // withhold the final verdict until receipt-backed execution occurs.
      execution_status: "NOT_EXECUTED",
      contradiction_pass_required: contradictionRequired,
      // A caller-provided source is evidence for/against the proposition, not
      // an adversarial contradiction search against the preliminary result.
      contradiction_pass_completed: false,
      denials: [],
      failures: []
    }
  });

  outcome.source_verdict = sourceVerdict;
  outcome.triage = triage;
  outcome.evidence_plan = evidencePlan;
  outcome.input_source = {
    source_url: String(lease.source_url),
    final_url: source.final_url || null,
    source_fingerprint: source.source_fingerprint || null,
    provenance: "CALLER_PROVIDED_SOURCE"
  };
  return outcome;
}

function snapshotSourceVerdict(lease) {
  return normalizeSourceVerdict({
    status: lease.status,
    evidence: lease.evidence ?? null,
    reason: lease.reason ?? null,
    confidence: lease.confidence,
    verifier: lease.verifier || null,
    proof_basis: lease.proof_basis || null
  });
}

function normalizeSourceVerdict(value) {
  return {
    status: normalizeVerdict(value?.status),
    evidence: value?.evidence ?? null,
    reason: value?.reason ?? null,
    confidence: finiteConfidence(value?.confidence),
    verifier: value?.verifier || null,
    proof_basis: value?.proof_basis || null
  };
}

function evidenceItemFromLease(lease, sourceVerdict, source = {}) {
  const verdict = sourceVerdict.status;
  const entailment = verdict === "SUPPORTED"
    ? "FULL_SUPPORT"
    : verdict === "CONTRADICTED"
      ? "CONTRADICTORY"
      : "UNKNOWN";
  const stance = verdict === "SUPPORTED"
    ? "FOR"
    : verdict === "CONTRADICTED"
      ? "AGAINST"
      : "AMBIGUOUS";
  const finalUrl = source.final_url || lease.final_url || lease.source_url;
  const fingerprint = source.source_fingerprint || lease.source_fingerprint || null;

  return {
    source_url: finalUrl,
    publisher: hostnameOrNull(finalUrl),
    observed_at: source.observed_at || lease.observed_at || lease.issued_at || new Date().toISOString(),
    entailment,
    stance,
    underlying_source_id: fingerprint,
    provenance: {
      type: "CALLER_PROVIDED_SOURCE",
      verifier: sourceVerdict.verifier,
      proof_basis: sourceVerdict.proof_basis,
      source_fingerprint: fingerprint,
      evidence_excerpt: sourceVerdict.evidence
    }
  };
}

function normalizeVerdict(value) {
  const normalized = String(value || "UNKNOWN").toUpperCase();
  return ["SUPPORTED", "CONTRADICTED", "UNKNOWN"].includes(normalized)
    ? normalized
    : "UNKNOWN";
}

function finiteConfidence(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.min(1, number)) : 0;
}

function hostnameOrNull(value) {
  try {
    return new URL(String(value)).hostname.toLowerCase();
  } catch {
    return null;
  }
}
