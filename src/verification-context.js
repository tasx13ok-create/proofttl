import { aggregateEvidence } from "./evidence-quality.js";
import { buildEvidencePlan, triageClaimContract } from "./verification-plan.js";
import { finalizeVerificationOutcome } from "./verification-outcome.js";

const OUTCOME_VERSION = "proofttl-verification-outcome-v1";

export function attachDerivedVerificationOutcome(lease) {
  if (!lease || typeof lease !== "object") return lease;
  if (lease.verification_outcome?.version === OUTCOME_VERSION) return lease;
  if (!lease.claim_contract || !lease.source_url || !lease.status) return lease;

  const sourceVerdict = snapshotSourceVerdict(lease);
  const triage = triageClaimContract(lease.claim_contract);
  const evidencePlan = buildEvidencePlan(lease.claim_contract, triage);
  const evidenceLedger = aggregateEvidence(
    [evidenceItemFromLease(lease, sourceVerdict)],
    { claim_contract: lease.claim_contract }
  );

  const contradictionRequired = evidencePlan.contradiction_pass_required === true;
  const outcome = finalizeVerificationOutcome({
    evidence_ledger: evidenceLedger,
    execution: {
      contradiction_pass_required: contradictionRequired,
      // A caller-provided source is evidence for the proposition, not an
      // adversarial contradiction search against the preliminary conclusion.
      // Until that retrieval path executes, high-assurance claims must fail
      // closed instead of inheriting a one-source verdict.
      contradiction_pass_completed: !contradictionRequired,
      denials: [],
      failures: []
    }
  });

  outcome.source_verdict = sourceVerdict;
  outcome.triage = triage;
  outcome.evidence_plan = evidencePlan;
  outcome.input_source = {
    source_url: String(lease.source_url),
    final_url: lease.final_url || null,
    source_fingerprint: lease.source_fingerprint || null,
    provenance: "CALLER_PROVIDED_SOURCE"
  };

  lease.verification_outcome = outcome;
  lease.source_verdict = sourceVerdict;

  // Keep the public lease verdict aligned with the signed final outcome. The
  // original single-source semantic result remains preserved above for audit.
  lease.status = outcome.verdict;
  lease.confidence = Number.isFinite(Number(outcome.confidence))
    ? Number(outcome.confidence)
    : 0;

  if (outcome.verdict !== sourceVerdict.status) {
    lease.reason = `verification_outcome:${outcome.execution_status}`;
    lease.proof_basis = "EVIDENCE_LEDGER";
  }

  return lease;
}

function snapshotSourceVerdict(lease) {
  return {
    status: normalizeVerdict(lease.status),
    evidence: lease.evidence ?? null,
    reason: lease.reason ?? null,
    confidence: finiteConfidence(lease.confidence),
    verifier: lease.verifier || null,
    proof_basis: lease.proof_basis || null
  };
}

function evidenceItemFromLease(lease, sourceVerdict) {
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

  return {
    source_url: lease.final_url || lease.source_url,
    publisher: hostnameOrNull(lease.final_url || lease.source_url),
    observed_at: lease.observed_at || lease.issued_at || new Date().toISOString(),
    entailment,
    stance,
    underlying_source_id: lease.source_fingerprint || null,
    provenance: {
      type: "CALLER_PROVIDED_SOURCE",
      verifier: sourceVerdict.verifier,
      proof_basis: sourceVerdict.proof_basis,
      source_fingerprint: lease.source_fingerprint || null,
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
