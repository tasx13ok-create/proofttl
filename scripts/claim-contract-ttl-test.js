import assert from "node:assert/strict";
import { buildClaimContract, normalizeClaim } from "../src/claim-contract.js";
import { deriveTtlPolicy } from "../src/ttl-policy.js";

const currentPrice = buildClaimContract("Acme currently charges $49 per month for its Pro plan.", { nowMs: Date.UTC(2026, 7, 29, 12, 0, 0) });
assert.equal(currentPrice.normalized_claim, "Acme currently charges $49 per month for its Pro plan");
assert.equal(currentPrice.volatility.level, "HIGH");
assert.equal(currentPrice.time_scope.type, "CURRENT");
assert.ok(currentPrice.quantities.includes("$49"));
assert.ok(["HIGH", "CRITICAL"].includes(currentPrice.verification_priority));

const livePrice = buildClaimContract("Acme stock price is $49 now.", { nowMs: Date.UTC(2026, 7, 29, 12, 0, 0) });
assert.equal(livePrice.volatility.level, "VERY_HIGH");

const certification = buildClaimContract("Vendor X is SOC 2 Type II certified.");
assert.equal(certification.risk_if_wrong.level, "HIGH");
assert.equal(certification.volatility.level, "HIGH");

const historical = buildClaimContract("Ada Lovelace was born in 1815.");
assert.equal(historical.volatility.level, "LOW");
assert.equal(historical.time_scope.type, "UNSPECIFIED");

assert.equal(normalizeClaim("  Hello   world. "), "Hello world");

const currentPolicy = deriveTtlPolicy({ claimContract: currentPrice, confidence: 0.9, sourceCount: 1 });
assert.ok(currentPolicy.ttl_seconds <= 6 * 60 * 60);
assert.ok(currentPolicy.ttl_seconds >= 60 * 60);
assert.ok(currentPolicy.recheck_recommended_seconds < currentPolicy.ttl_seconds);

const realtimePolicy = deriveTtlPolicy({ claimContract: livePrice, confidence: 0.9, sourceCount: 1 });
assert.ok(realtimePolicy.ttl_seconds <= 15 * 60);
assert.ok(realtimePolicy.ttl_seconds < currentPolicy.ttl_seconds);

const historicalPolicy = deriveTtlPolicy({ claimContract: historical, confidence: 0.98, sourceCount: 3 });
assert.ok(historicalPolicy.ttl_seconds >= 7 * 24 * 60 * 60);
assert.ok(historicalPolicy.ttl_seconds > currentPolicy.ttl_seconds);

const disputedPolicy = deriveTtlPolicy({ claimContract: certification, confidence: 0.72, contradictionCount: 1, sourceCount: 2 });
const cleanPolicy = deriveTtlPolicy({ claimContract: certification, confidence: 0.9, contradictionCount: 0, sourceCount: 2 });
assert.ok(disputedPolicy.ttl_seconds < cleanPolicy.ttl_seconds);

const capped = deriveTtlPolicy({ claimContract: currentPrice, confidence: 0.9, sourceCount: 1, requestedTtlSeconds: 86400 });
assert.ok(capped.ttl_seconds <= capped.policy_ttl_seconds);
assert.ok(capped.reasons.includes("CALLER_REQUEST_CAPPED_BY_POLICY"));

console.log("claim-contract-ttl-test: ok");
