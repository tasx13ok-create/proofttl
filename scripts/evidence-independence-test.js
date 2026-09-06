import assert from "node:assert/strict";
import { aggregateEvidence } from "../src/evidence-quality.js";

const excerpt = (text) => ({ evidence_excerpt: text });
const directional = (source_url, publisher, id, text, scores = 0.98) => ({
  source_url,
  publisher,
  underlying_source_id: id,
  source_type: "PRIMARY",
  entailment: "FULL_SUPPORT",
  stance: "FOR",
  authority_score: scores,
  directness_score: scores,
  specificity_score: scores,
  independence_score: scores,
  reputation_score: scores,
  provenance: excerpt(text)
});

const sameHost = aggregateEvidence([
  directional("https://docs.acme.example/pricing/current", null, "sha256:page-a", "Acme Pro costs $20 per month."),
  directional("https://docs.acme.example/plans/pro", null, "sha256:page-b", "The Pro plan is $20 monthly.")
]);
assert.equal(sameHost.evidence_for.length, 2, "distinct pages should remain distinct ledger items");
assert.equal(sameHost.metrics.independent_support_groups, 1, "same publisher host must count as one independent origin");

const samePublisherAcrossSubdomains = aggregateEvidence([
  directional("https://docs.acme.example/pricing/current", "Acme Corporation", "sha256:docs-page", "Acme Pro costs $20 per month."),
  directional("https://newsroom.acme.example/releases/pro-pricing", "Acme Corporation", "sha256:newsroom-page", "Acme confirms Pro remains $20 monthly.")
]);
assert.equal(samePublisherAcrossSubdomains.evidence_for.length, 2, "sibling-subdomain pages should remain distinct ledger items");
assert.equal(samePublisherAcrossSubdomains.metrics.independent_support_groups, 1, "explicit publisher identity must prevent sibling subdomains from manufacturing independent corroboration");

const sameHostDifferentPublisherLabels = aggregateEvidence([
  directional("https://docs.acme.example/fact-a", "Acme Corporation", "sha256:label-a", "Acme page A supports the claim.", 0.6),
  directional("https://docs.acme.example/fact-b", "ACME Corp.", "sha256:label-b", "Acme page B supports the claim.", 0.6)
]);
assert.equal(sameHostDifferentPublisherLabels.evidence_for.length, 2, "same-host pages with conflicting publisher labels remain auditable");
assert.equal(sameHostDifferentPublisherLabels.metrics.independent_support_groups, 1, "provider-controlled publisher spelling must not split one host into independent origins");
assert.ok(sameHostDifferentPublisherLabels.metrics.support_strength < 0.72, "same-host publisher aliases must not stack corroboration strength");
assert.equal(sameHostDifferentPublisherLabels.verdict, "UNKNOWN", "publisher label drift on one host must not manufacture a definitive verdict");

const transitivePublisherHostAlias = aggregateEvidence([
  directional("https://docs.acme.example/fact-a", "Acme Corporation", "sha256:bridge-a", "Acme docs support the claim.", 0.6),
  directional("https://docs.acme.example/fact-b", "ACME Corp.", "sha256:bridge-b", "Acme docs repeat the claim.", 0.6),
  directional("https://newsroom.acme.example/fact-c", "Acme Corporation", "sha256:bridge-c", "Acme newsroom supports the claim.", 0.6)
]);
assert.equal(transitivePublisherHostAlias.metrics.independent_support_groups, 1, "publisher and hostname aliases must merge transitively into one publishing origin");
assert.ok(transitivePublisherHostAlias.metrics.support_strength < 0.72, "transitively linked publisher aliases must not add corroboration strength");

const modestSamePublisher = aggregateEvidence([
  directional("https://docs.acme.example/fact-a", "Acme Corporation", "sha256:modest-a", "Acme page A supports the claim.", 0.6),
  directional("https://newsroom.acme.example/fact-b", "Acme Corporation", "sha256:modest-b", "Acme page B supports the claim.", 0.6)
]);
assert.equal(modestSamePublisher.evidence_for.length, 2, "same-publisher pages should remain visible in the ledger");
assert.equal(modestSamePublisher.metrics.independent_support_groups, 1);
assert.ok(modestSamePublisher.metrics.support_strength < 0.72, "same-publisher pages must not stack corroboration strength");
assert.equal(modestSamePublisher.verdict, "UNKNOWN", "one publisher must not manufacture a definitive verdict by repeating modest evidence");

const modestIndependentPublishers = aggregateEvidence([
  directional("https://acme.example/fact-a", "Acme Corporation", "sha256:independent-a", "Acme supports the claim.", 0.6),
  directional("https://registry.example/fact-b", "Independent Registry", "sha256:independent-b", "The independent registry supports the claim.", 0.6)
]);
assert.equal(modestIndependentPublishers.metrics.independent_support_groups, 2);
assert.ok(modestIndependentPublishers.metrics.support_strength >= 0.72, "a genuinely independent second origin may add corroboration strength");
assert.equal(modestIndependentPublishers.verdict, "SUPPORTED");

const separateHosts = aggregateEvidence([
  directional("https://docs.acme.example/pricing/current", null, "sha256:acme", "Acme Pro costs $20 per month."),
  {
    ...directional("https://registry.example/vendors/acme", null, "sha256:registry", "Registry lists Acme Pro at $20 per month.", 0.9),
    source_type: "SECONDARY",
    independence_score: 0.95,
    reputation_score: 0.95
  }
]);
assert.equal(separateHosts.metrics.independent_support_groups, 2, "separate publisher hosts should count as separate origins");

const mirrored = aggregateEvidence([
  directional("https://mirror-a.example/report", null, "report-42", "Report 42 supports the claim.", 0.9),
  directional("https://mirror-b.example/report-copy", null, "report-42", "Report 42 supports the claim.", 0.85)
]);
assert.equal(mirrored.evidence_for.length, 1, "mirrors of one underlying source must dedupe before independence counting");
assert.equal(mirrored.metrics.independent_support_groups, 1);

const supportMarkedAgainst = aggregateEvidence([{
  ...directional("https://source.example/support", null, null, "The source directly supports the claim.", 0.99),
  stance: "AGAINST"
}]);
assert.equal(supportMarkedAgainst.verdict, "UNKNOWN", "support evidence with an opposing stance must fail closed");
assert.equal(supportMarkedAgainst.evidence_against.length, 0, "mismatched support must not be counted as contradiction");
assert.equal(supportMarkedAgainst.rejected_evidence.length, 1);
assert.ok(supportMarkedAgainst.rejected_evidence[0].reasons.includes("REJECTED_STANCE_ENTAILMENT_MISMATCH"));

const contradictionMarkedFor = aggregateEvidence([{
  source_url: "https://source.example/contradiction",
  entailment: "CONTRADICTORY",
  stance: "FOR",
  authority_score: 0.99,
  directness_score: 0.99,
  specificity_score: 0.99,
  independence_score: 0.99,
  reputation_score: 0.99,
  provenance: excerpt("The source directly contradicts the claim.")
}]);
assert.equal(contradictionMarkedFor.verdict, "UNKNOWN", "contradictory evidence with a supporting stance must fail closed");
assert.equal(contradictionMarkedFor.evidence_for.length, 0, "mismatched contradiction must not be counted as support");
assert.equal(contradictionMarkedFor.rejected_evidence.length, 1);
assert.ok(contradictionMarkedFor.rejected_evidence[0].reasons.includes("REJECTED_STANCE_ENTAILMENT_MISMATCH"));

const acceptedContextTiming = { observed_at: "2026-09-05T09:00:00.000Z", published_at: "2026-09-05T09:00:00.000Z" };
const contextMarkedAgainst = aggregateEvidence([
  { source_url: "https://source.example/context", entailment: "CONTEXT_ONLY", stance: "AGAINST", authority_score: 1, directness_score: 1, specificity_score: 1, independence_score: 1, reputation_score: 1, ...acceptedContextTiming },
  { source_url: "https://other.example/context", entailment: "CONTEXT_ONLY", stance: "AGAINST", authority_score: 1, directness_score: 1, specificity_score: 1, independence_score: 1, reputation_score: 1, ...acceptedContextTiming }
]);
assert.equal(contextMarkedAgainst.verdict, "UNKNOWN", "context-only evidence must never manufacture contradiction");
assert.equal(contextMarkedAgainst.evidence_against.length, 0, "context-only items must not enter the contradiction side");
assert.equal(contextMarkedAgainst.metrics.contradiction_strength, 0);
assert.equal(contextMarkedAgainst.metrics.independent_contradiction_groups, 0);
assert.equal(contextMarkedAgainst.ambiguous_evidence.length, 2, "accepted context should remain auditable as non-directional evidence");

const unknownMarkedFor = aggregateEvidence([
  { source_url: "https://source.example/unknown", entailment: "UNKNOWN", stance: "FOR", authority_score: 1, directness_score: 1, specificity_score: 1, independence_score: 1, reputation_score: 1 },
  { source_url: "https://other.example/unknown", entailment: "UNKNOWN", stance: "FOR", authority_score: 1, directness_score: 1, specificity_score: 1, independence_score: 1, reputation_score: 1 }
]);
assert.equal(unknownMarkedFor.verdict, "UNKNOWN", "unknown entailment must never manufacture support");
assert.equal(unknownMarkedFor.evidence_for.length, 0, "unknown items must not enter the support side");
assert.equal(unknownMarkedFor.metrics.support_strength, 0);
assert.equal(unknownMarkedFor.metrics.independent_support_groups, 0);
assert.equal(unknownMarkedFor.ambiguous_evidence.length, 2, "accepted unknown items should remain non-directional");

console.log("SUCCESS: evidence independence and semantic consistency checks passed.");
