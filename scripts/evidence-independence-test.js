import assert from "node:assert/strict";
import { aggregateEvidence } from "../src/evidence-quality.js";

const excerpt = (text) => ({ evidence_excerpt: text });

const sameHost = aggregateEvidence([
  {
    source_url: "https://docs.acme.example/pricing/current",
    underlying_source_id: "sha256:page-a",
    source_type: "PRIMARY",
    entailment: "FULL_SUPPORT",
    stance: "FOR",
    authority_score: 0.98,
    directness_score: 0.98,
    specificity_score: 0.98,
    independence_score: 0.9,
    reputation_score: 0.95,
    provenance: excerpt("Acme Pro costs $20 per month.")
  },
  {
    source_url: "https://docs.acme.example/plans/pro",
    underlying_source_id: "sha256:page-b",
    source_type: "PRIMARY",
    entailment: "FULL_SUPPORT",
    stance: "FOR",
    authority_score: 0.98,
    directness_score: 0.98,
    specificity_score: 0.98,
    independence_score: 0.9,
    reputation_score: 0.95,
    provenance: excerpt("The Pro plan is $20 monthly.")
  }
]);

assert.equal(sameHost.evidence_for.length, 2, "distinct pages should remain distinct ledger items");
assert.equal(sameHost.metrics.independent_support_groups, 1, "same publisher host must count as one independent origin");

const separateHosts = aggregateEvidence([
  {
    source_url: "https://docs.acme.example/pricing/current",
    underlying_source_id: "sha256:acme",
    source_type: "PRIMARY",
    entailment: "FULL_SUPPORT",
    stance: "FOR",
    authority_score: 0.98,
    directness_score: 0.98,
    specificity_score: 0.98,
    independence_score: 0.9,
    reputation_score: 0.95,
    provenance: excerpt("Acme Pro costs $20 per month.")
  },
  {
    source_url: "https://registry.example/vendors/acme",
    underlying_source_id: "sha256:registry",
    source_type: "SECONDARY",
    entailment: "FULL_SUPPORT",
    stance: "FOR",
    authority_score: 0.9,
    directness_score: 0.9,
    specificity_score: 0.9,
    independence_score: 0.95,
    reputation_score: 0.95,
    provenance: excerpt("Registry lists Acme Pro at $20 per month.")
  }
]);

assert.equal(separateHosts.metrics.independent_support_groups, 2, "separate publisher hosts should count as separate origins");

const mirrored = aggregateEvidence([
  {
    source_url: "https://mirror-a.example/report",
    underlying_source_id: "report-42",
    entailment: "FULL_SUPPORT",
    stance: "FOR",
    authority_score: 0.9,
    directness_score: 0.9,
    specificity_score: 0.9,
    independence_score: 0.9,
    reputation_score: 0.9,
    provenance: excerpt("Report 42 supports the claim.")
  },
  {
    source_url: "https://mirror-b.example/report-copy",
    underlying_source_id: "report-42",
    entailment: "FULL_SUPPORT",
    stance: "FOR",
    authority_score: 0.85,
    directness_score: 0.85,
    specificity_score: 0.85,
    independence_score: 0.85,
    reputation_score: 0.85,
    provenance: excerpt("Report 42 supports the claim.")
  }
]);

assert.equal(mirrored.evidence_for.length, 1, "mirrors of one underlying source must dedupe before independence counting");
assert.equal(mirrored.metrics.independent_support_groups, 1);

console.log("SUCCESS: evidence independence origin checks passed.");
