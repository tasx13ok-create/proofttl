import {
  CLOUDFLARE_MARGINAL_PRICING,
  defaultMonitorIntervalSeconds,
  estimateLeaseEconomics
} from "../src/economics.js";

let passed = 0;

function assert(condition, message) {
  if (!condition) throw new Error(message);
  passed += 1;
  console.log(`PASS ${passed}: ${message}`);
}

function approx(actual, expected, epsilon = 1e-12) {
  return Math.abs(actual - expected) <= epsilon;
}

async function run() {
  console.log("ProofTTL lease economics regression test\n");

  assert(defaultMonitorIntervalSeconds(300) === 100, "300s TTL defaults to a 100s monitor interval");
  assert(defaultMonitorIntervalSeconds(3600) === 1200, "3600s TTL defaults to a 1200s monitor interval");
  assert(defaultMonitorIntervalSeconds(604800) === 3600, "long TTL monitor interval is capped at one hour");

  const deterministic = estimateLeaseEconomics({
    promptTokens: 0,
    completionTokens: 0,
    ttlSeconds: 300,
    sourceChangeRatePerCheck: 0,
    activeLeasesSharingMonitor: 100,
    targetGrossMargin: 0.8
  });
  assert(deterministic.operations.expected_monitor_checks === 2, "300s lease has two checks before expiry");
  assert(deterministic.costs_usd.issuance_ai === 0, "deterministic issuance has zero AI cost");
  assert(deterministic.pricing_usd.target_at_margin > deterministic.pricing_usd.break_even, "margin target is above break-even");

  const semantic = estimateLeaseEconomics({
    promptTokens: 7500,
    completionTokens: 100,
    ttlSeconds: 3600,
    sourceChangeRatePerCheck: 0.25,
    activeLeasesSharingMonitor: 1000,
    targetGrossMargin: 0.8
  });
  const issueAi = (7500 * 0.293 + 100 * 2.253) / 1_000_000;
  assert(approx(semantic.costs_usd.issuance_ai, issueAi), "semantic issuance uses the configured AI token price");
  assert(semantic.operations.expected_monitor_checks === 2, "one-hour lease has two checks before expiry");
  assert(semantic.operations.expected_changed_source_checks === 0.5, "source-change rate drives expected semantic rechecks");
  assert(approx(semantic.costs_usd.expected_monitoring_ai, issueAi * 0.5), "monitoring AI cost is probability weighted");

  const lowScale = estimateLeaseEconomics({ ttlSeconds: 3600, activeLeasesSharingMonitor: 1 });
  const highScale = estimateLeaseEconomics({ ttlSeconds: 3600, activeLeasesSharingMonitor: 1000 });
  assert(lowScale.operations.kv_lists > highScale.operations.kv_lists, "monitor list overhead amortizes across active leases");
  assert(lowScale.costs_usd.platform_marginal > highScale.costs_usd.platform_marginal, "higher lease density reduces per-lease scan overhead");

  const volume = estimateLeaseEconomics({ monthlyPaidVerifications: 10_000 });
  assert(
    approx(volume.costs_usd.allocated_paid_plan_base, CLOUDFLARE_MARGINAL_PRICING.paid_plan_base_usd_per_month / 10_000),
    "optional monthly volume allocates the paid-plan base cost per verification"
  );

  const margin = estimateLeaseEconomics({
    promptTokens: 1000,
    completionTokens: 50,
    targetGrossMargin: 0.75
  });
  assert(
    approx(margin.pricing_usd.target_at_margin, margin.pricing_usd.break_even / 0.25),
    "target price follows cost divided by one minus gross margin"
  );

  console.log(`\nSUCCESS: ${passed} ProofTTL lease economics checks passed.`);
}

run().catch((error) => {
  console.error("\nECONOMICS TEST FAILED:", error.stack || error.message);
  process.exitCode = 1;
});
