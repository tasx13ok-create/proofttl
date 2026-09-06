import assert from "node:assert/strict";
import { aggregateEvidence } from "../src/evidence-quality.js";

const excerpt = (text) => ({ evidence_excerpt: text });
const directional = (source_url, publisher, text) => ({
  source_url,
  publisher,
  entailment: "FULL_SUPPORT",
  stance: "FOR",
  authority_score: 0.8,
  directness_score: 0.8,
  specificity_score: 0.8,
  independence_score: 0.8,
  reputation_score: 0.8,
  provenance: excerpt(text)
});

const oneDirectional = aggregateEvidence([
  directional("https://acme.example/fact", "Acme", "Acme supports the claim.")
]);
const repeatedSameOrigin = aggregateEvidence([
  directional("https://acme.example/fact-a", "Acme", "Acme page A supports the claim."),
  directional("https://acme.example/fact-b", "Acme", "Acme page B supports the claim."),
  directional("https://news.acme.example/fact-c", "Acme", "Acme page C supports the claim.")
]);
assert.equal(repeatedSameOrigin.metrics.accepted_count, 3);
assert.equal(repeatedSameOrigin.metrics.independent_support_groups, 1);
assert.equal(repeatedSameOrigin.confidence, oneDirectional.confidence, "same-origin repetition must not raise confidence coverage");

const contextOnly = aggregateEvidence([
  {
    source_url: "https://context-a.example/page",
    publisher: "Context A",
    entailment: "CONTEXT_ONLY",
    stance: "AMBIGUOUS",
    authority_score: 1,
    directness_score: 1,
    specificity_score: 1,
    independence_score: 1,
    reputation_score: 1,
    observed_at: "2026-09-05T09:00:00.000Z",
    published_at: "2026-09-05T09:00:00.000Z"
  },
  {
    source_url: "https://context-b.example/page",
    publisher: "Context B",
    entailment: "UNKNOWN",
    stance: "AMBIGUOUS",
    authority_score: 1,
    directness_score: 1,
    specificity_score: 1,
    independence_score: 1,
    reputation_score: 1,
    observed_at: "2026-09-05T09:00:00.000Z",
    published_at: "2026-09-05T09:00:00.000Z"
  }
]);
assert.equal(contextOnly.metrics.accepted_count, 2);
assert.equal(contextOnly.metrics.ambiguous_count, 2);
assert.equal(contextOnly.confidence, 0, "non-directional context must not manufacture verdict confidence");

const recordUrls = aggregateEvidence([
  directional("https://registry.example/record?id=100", "Registry", "Record 100 supports the claim."),
  directional("https://registry.example/record?id=101", "Registry", "Record 101 supports the claim.")
]);
assert.equal(recordUrls.evidence_for.length, 2, "query parameters that identify distinct records must participate in URL identity");

const sameQueryDifferentOrder = aggregateEvidence([
  directional("https://registry.example/record?type=company&id=100", "Registry", "Record 100 supports the claim."),
  directional("https://registry.example/record?id=100&type=company", "Registry", "Record 100 supports the claim.")
]);
assert.equal(sameQueryDifferentOrder.evidence_for.length, 1, "query parameter order must not create duplicate evidence identities");

console.log("SUCCESS: evidence identity and confidence coverage checks passed.");
