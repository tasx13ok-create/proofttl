const TRIAGE_VERSION = "proofttl-triage-v1";
const EVIDENCE_PLAN_VERSION = "proofttl-evidence-plan-v1";

const PRIORITY_SCORE = Object.freeze({ LOW: 0, MEDIUM: 1, HIGH: 2, CRITICAL: 3 });
const VOLATILITY_SCORE = Object.freeze({ LOW: 0, MEDIUM: 1, HIGH: 2, VERY_HIGH: 3 });

const SOURCE_HYPOTHESES = Object.freeze({
  COMPLIANCE: [
    "AUTHORITATIVE_CERTIFICATION_OR_REGISTRY",
    "ISSUER_TRUST_OR_COMPLIANCE_DOCUMENTATION",
    "INDEPENDENT_AUDITOR_OR_REGULATOR_RECORD"
  ],
  COMMERCIAL_DYNAMIC: [
    "CURRENT_VENDOR_PRODUCT_DOCUMENTATION",
    "CURRENT_VENDOR_PRICING_OR_PLAN_DOCUMENTATION",
    "VENDOR_CHANGELOG_OR_RELEASE_NOTES"
  ],
  MONEY: [
    "REGULATORY_FILING_OR_OFFICIAL_FINANCIAL_REPORT",
    "PRIMARY_COMPANY_FINANCIAL_DISCLOSURE",
    "AUTHORITATIVE_STATISTICAL_SOURCE"
  ],
  POLICY: [
    "OFFICIAL_GOVERNMENT_OR_REGULATOR_TEXT",
    "CURRENT_ORGANIZATION_POLICY_DOCUMENT",
    "AUTHORITATIVE_REGISTER_OR_RECORD"
  ],
  HISTORICAL: [
    "PRIMARY_ARCHIVAL_OR_OFFICIAL_RECORD",
    "AUTHORITATIVE_REFERENCE_SOURCE"
  ],
  GENERAL: [
    "PRIMARY_ISSUER_OR_OFFICIAL_RECORD",
    "INDEPENDENT_AUTHORITATIVE_SOURCE"
  ]
});

export function triageClaimContract(claimContract, options = {}) {
  validateClaimContract(claimContract);

  const priority = normalizeLevel(claimContract.verification_priority, PRIORITY_SCORE, "MEDIUM");
  const volatility = normalizeLevel(claimContract.volatility?.level, VOLATILITY_SCORE, "MEDIUM");
  const riskScore = clampInt(claimContract.risk_if_wrong?.score, 0, 5, 0);
  const ambiguityCount = Array.isArray(claimContract.ambiguities) ? claimContract.ambiguities.length : 0;
  const userHighAssurance = options.high_assurance === true;

  const riskDepth =
    userHighAssurance || priority === "CRITICAL" || riskScore >= 5
      ? "HIGH_ASSURANCE"
      : priority === "HIGH" || riskScore >= 3
        ? "CONTRADICTION_HUNT"
        : priority === "MEDIUM" || volatility === "HIGH" || volatility === "VERY_HIGH"
          ? "BROAD_RETRIEVAL"
          : "PRIMARY_LOOKUP";

  const decision =
    priority === "LOW" && riskScore === 0 && volatility === "LOW"
      ? "DEFER_LOW_VALUE"
      : "VERIFY";

  const contradictionRequired =
    decision === "VERIFY" &&
    (riskDepth === "CONTRADICTION_HUNT" || riskDepth === "HIGH_ASSURANCE" || ambiguityCount > 0 || volatility === "VERY_HIGH");

  const reasons = [
    `PRIORITY_${priority}`,
    `RISK_${normalizeRiskLevel(claimContract.risk_if_wrong?.level)}`,
    `VOLATILITY_${volatility}`,
    ...(ambiguityCount ? [`AMBIGUITIES_${ambiguityCount}`] : []),
    ...(userHighAssurance ? ["CALLER_REQUESTED_HIGH_ASSURANCE"] : []),
    decision === "DEFER_LOW_VALUE" ? "ZERO_DOLLAR_TRIAGE_DEFER" : `DEPTH_${riskDepth}`
  ];

  return {
    version: TRIAGE_VERSION,
    claim_contract_version: claimContract.version,
    decision,
    verification_depth: riskDepth,
    contradiction_pass_required: contradictionRequired,
    priority,
    volatility,
    risk_if_wrong: {
      level: normalizeRiskLevel(claimContract.risk_if_wrong?.level),
      score: riskScore
    },
    ambiguity_count: ambiguityCount,
    reasons,
    stage_contract: {
      stage: "TRIAGE",
      input_type: "proofttl-claim-contract-v1",
      output_type: TRIAGE_VERSION,
      latency_budget_ms: 25,
      max_external_calls: 0,
      max_model_calls: 0,
      cost_ceiling_usd: 0,
      failure_value: "DEFER_WITHOUT_VERDICT"
    }
  };
}

export function buildEvidencePlan(claimContract, triage = null) {
  validateClaimContract(claimContract);
  const resolvedTriage = triage || triageClaimContract(claimContract);
  validateTriage(resolvedTriage);

  if (resolvedTriage.decision !== "VERIFY") {
    return {
      version: EVIDENCE_PLAN_VERSION,
      claim_contract_version: claimContract.version,
      triage_version: resolvedTriage.version,
      status: "NOT_SCHEDULED",
      reason: "TRIAGE_DEFERRED",
      source_hypotheses: [],
      query_intents: [],
      contradiction_pass_required: false,
      execution_budget: zeroEvidenceBudget(),
      failure_value: "UNKNOWN"
    };
  }

  const category = inferEvidenceCategory(claimContract);
  const depth = resolvedTriage.verification_depth;
  const budget = evidenceBudget(depth);
  const proposition = String(claimContract.normalized_claim || "").trim();

  return {
    version: EVIDENCE_PLAN_VERSION,
    claim_contract_version: claimContract.version,
    triage_version: resolvedTriage.version,
    status: "PLANNED",
    category,
    verification_depth: depth,
    source_hypotheses: SOURCE_HYPOTHESES[category],
    query_intents: buildQueryIntents(proposition, category, resolvedTriage.contradiction_pass_required),
    contradiction_pass_required: resolvedTriage.contradiction_pass_required,
    acceptance_requirements: {
      retrieval_is_not_evidence: true,
      accepted_items_require_claim_position: true,
      accepted_items_require_observed_at: true,
      accepted_items_require_provenance: true,
      duplicates_count_as_one_origin: true,
      primary_source_preferred_when_appropriate: true
    },
    execution_budget: budget,
    failure_value: "UNKNOWN"
  };
}

function evidenceBudget(depth) {
  if (depth === "HIGH_ASSURANCE") {
    return {
      max_candidate_queries: 8,
      max_source_fetches: 16,
      max_semantic_evaluations: 16,
      max_contradiction_queries: 4,
      latency_budget_ms: 45000,
      hard_cost_ceiling_usd: null,
      hard_cost_ceiling_state: "REQUIRES_RUNTIME_PRICING_ENFORCEMENT"
    };
  }
  if (depth === "CONTRADICTION_HUNT") {
    return {
      max_candidate_queries: 6,
      max_source_fetches: 12,
      max_semantic_evaluations: 12,
      max_contradiction_queries: 3,
      latency_budget_ms: 30000,
      hard_cost_ceiling_usd: null,
      hard_cost_ceiling_state: "REQUIRES_RUNTIME_PRICING_ENFORCEMENT"
    };
  }
  if (depth === "BROAD_RETRIEVAL") {
    return {
      max_candidate_queries: 4,
      max_source_fetches: 8,
      max_semantic_evaluations: 8,
      max_contradiction_queries: 1,
      latency_budget_ms: 20000,
      hard_cost_ceiling_usd: null,
      hard_cost_ceiling_state: "REQUIRES_RUNTIME_PRICING_ENFORCEMENT"
    };
  }
  return {
    max_candidate_queries: 2,
    max_source_fetches: 3,
    max_semantic_evaluations: 3,
    max_contradiction_queries: 0,
    latency_budget_ms: 10000,
    hard_cost_ceiling_usd: null,
    hard_cost_ceiling_state: "REQUIRES_RUNTIME_PRICING_ENFORCEMENT"
  };
}

function zeroEvidenceBudget() {
  return {
    max_candidate_queries: 0,
    max_source_fetches: 0,
    max_semantic_evaluations: 0,
    max_contradiction_queries: 0,
    latency_budget_ms: 0,
    hard_cost_ceiling_usd: 0,
    hard_cost_ceiling_state: "ENFORCED_BY_NO_EXECUTION"
  };
}

function inferEvidenceCategory(contract) {
  const riskSignals = new Set(contract.risk_if_wrong?.signals || []);
  const volatilityReason = String(contract.volatility?.reason || "");
  const claim = String(contract.normalized_claim || "");

  if (riskSignals.has("COMPLIANCE")) return "COMPLIANCE";
  if (volatilityReason === "COMMERCIAL_DYNAMIC") return "COMMERCIAL_DYNAMIC";
  if (riskSignals.has("MONEY")) return "MONEY";
  if (volatilityReason === "ROLE_POLICY" || /\b(law|regulation|policy|rule|statute)\b/i.test(claim)) return "POLICY";
  if (volatilityReason === "HISTORICAL") return "HISTORICAL";
  return "GENERAL";
}

function buildQueryIntents(proposition, category, contradictionRequired) {
  const claim = bound(proposition, 700);
  const intents = [
    {
      purpose: "PRIMARY_SUPPORT_OR_REFUTATION",
      source_class: SOURCE_HYPOTHESES[category][0],
      query: claim
    }
  ];

  if (category === "COMMERCIAL_DYNAMIC") {
    intents.push({ purpose: "CURRENT_SCOPE_AND_VERSION", source_class: "CURRENT_VENDOR_DOCUMENTATION", query: `${claim} current documentation pricing plan version` });
  } else if (category === "COMPLIANCE") {
    intents.push({ purpose: "INDEPENDENT_STATUS_RECORD", source_class: "REGISTRY_AUDITOR_OR_REGULATOR", query: `${claim} registry auditor certification status` });
  } else if (category === "MONEY") {
    intents.push({ purpose: "PRIMARY_NUMBER_SOURCE", source_class: "FILING_REPORT_OR_OFFICIAL_STATISTICS", query: `${claim} filing report official statistics` });
  } else if (category === "POLICY") {
    intents.push({ purpose: "CURRENT_EFFECTIVE_TEXT", source_class: "OFFICIAL_POLICY_OR_REGULATION", query: `${claim} official current effective text` });
  }

  if (contradictionRequired) {
    intents.push({
      purpose: "ADVERSARIAL_CONTRADICTION",
      source_class: "STRONGEST_AVAILABLE_COUNTEREVIDENCE",
      query: `${claim} changed superseded exception contradiction`
    });
  }

  return intents.slice(0, 4).map((intent) => ({ ...intent, query: bound(intent.query, 900) }));
}

function validateClaimContract(contract) {
  if (!contract || typeof contract !== "object") throw new Error("triage_claim_contract_required");
  if (contract.version !== "proofttl-claim-contract-v1") throw new Error("triage_claim_contract_version_unsupported");
  if (!String(contract.normalized_claim || "").trim()) throw new Error("triage_normalized_claim_required");
}

function validateTriage(triage) {
  if (!triage || triage.version !== TRIAGE_VERSION) throw new Error("evidence_plan_triage_required");
  if (!triage.decision) throw new Error("evidence_plan_triage_decision_required");
}

function normalizeLevel(value, table, fallback) {
  const level = String(value || "").toUpperCase();
  return Object.prototype.hasOwnProperty.call(table, level) ? level : fallback;
}

function normalizeRiskLevel(value) {
  const level = String(value || "LOW").toUpperCase();
  return ["LOW", "MEDIUM", "HIGH"].includes(level) ? level : "LOW";
}

function clampInt(value, min, max, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? Math.max(min, Math.min(max, parsed)) : fallback;
}

function bound(value, max) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, max);
}
