import { estimateAiCostUsd } from "./costs.js";

// Marginal Workers Paid rates after included monthly allocations.
// Snapshot checked against official Cloudflare pricing on 2026-08-17.
export const CLOUDFLARE_MARGINAL_PRICING = Object.freeze({
  checked_at: "2026-08-17",
  worker_request_usd: 0.30 / 1_000_000,
  worker_cpu_ms_usd: 0.02 / 1_000_000,
  kv_read_usd: 0.50 / 1_000_000,
  kv_write_usd: 5.00 / 1_000_000,
  kv_list_usd: 5.00 / 1_000_000,
  log_event_usd: 0.60 / 1_000_000,
  paid_plan_base_usd_per_month: 5
});

export function defaultMonitorIntervalSeconds(ttlSeconds) {
  const ttl = positiveNumber(ttlSeconds, 3600);
  return Math.max(60, Math.min(3600, Math.floor(ttl / 3)));
}

export function estimateLeaseEconomics({
  promptTokens = 0,
  completionTokens = 0,
  ttlSeconds = 3600,
  monitorIntervalSeconds = null,
  sourceChangeRatePerCheck = 0,
  activeLeasesSharingMonitor = 1,
  targetGrossMargin = 0.8,
  monthlyPaidVerifications = 0,
  workerCpuMsPerLifecycle = 0,
  pricing = CLOUDFLARE_MARGINAL_PRICING
} = {}) {
  const ttl = positiveNumber(ttlSeconds, 3600);
  const monitorInterval = positiveNumber(
    monitorIntervalSeconds,
    defaultMonitorIntervalSeconds(ttl)
  );
  const activeLeases = Math.max(1, Math.floor(positiveNumber(activeLeasesSharingMonitor, 1)));
  const changeRate = clamp(sourceChangeRatePerCheck, 0, 1);
  const margin = clamp(targetGrossMargin, 0, 0.99);
  const monthlyVolume = Math.max(0, Math.floor(numberOrZero(monthlyPaidVerifications)));
  const cpuMs = Math.max(0, numberOrZero(workerCpuMsPerLifecycle));

  // A check exactly at expiry becomes an expiry transition rather than a source
  // reverification, so subtract the final expiry boundary from the interval count.
  const expectedMonitorChecks = Math.max(0, Math.ceil(ttl / monitorInterval) - 1);
  const expectedChangedSourceChecks = expectedMonitorChecks * changeRate;

  const issueAiCost = estimateAiCostUsd({
    prompt_tokens: numberOrZero(promptTokens),
    completion_tokens: numberOrZero(completionTokens)
  }) ?? 0;
  const expectedMonitoringAiCost = issueAiCost * expectedChangedSourceChecks;
  const aiCost = issueAiCost + expectedMonitoringAiCost;

  // Issuance writes one lease. Each due automatic check reads + writes the
  // lease. At natural expiry the monitor reads + writes once more.
  const kvReads = expectedMonitorChecks + 1;
  const kvWrites = 1 + expectedMonitorChecks + 1;

  // The current monitor wakes and lists once per minute globally. Allocate its
  // list/request overhead across active leases so scale assumptions are explicit.
  const monitorRunsDuringLease = Math.ceil(ttl / 60);
  const allocatedMonitorRuns = monitorRunsDuringLease / activeLeases;
  const kvLists = allocatedMonitorRuns;
  const workerRequests = 1 + allocatedMonitorRuns;

  // One structured economics log at issuance and one per automatic check.
  const logEvents = 1 + expectedMonitorChecks;

  const platformCost =
    workerRequests * pricing.worker_request_usd +
    cpuMs * pricing.worker_cpu_ms_usd +
    kvReads * pricing.kv_read_usd +
    kvWrites * pricing.kv_write_usd +
    kvLists * pricing.kv_list_usd +
    logEvents * pricing.log_event_usd;

  const allocatedBasePlanCost = monthlyVolume > 0
    ? pricing.paid_plan_base_usd_per_month / monthlyVolume
    : 0;

  const estimatedLifetimeCostUsd =
    aiCost + platformCost + allocatedBasePlanCost;
  const breakEvenPriceUsd = estimatedLifetimeCostUsd;
  const targetPriceUsd = estimatedLifetimeCostUsd / (1 - margin);

  return {
    assumptions: {
      ttl_seconds: ttl,
      monitor_interval_seconds: monitorInterval,
      source_change_rate_per_check: changeRate,
      active_leases_sharing_monitor: activeLeases,
      target_gross_margin: margin,
      monthly_paid_verifications: monthlyVolume,
      worker_cpu_ms_per_lifecycle: cpuMs,
      pricing_checked_at: pricing.checked_at
    },
    operations: {
      expected_monitor_checks: expectedMonitorChecks,
      expected_changed_source_checks: expectedChangedSourceChecks,
      allocated_monitor_runs: allocatedMonitorRuns,
      worker_requests: workerRequests,
      kv_reads: kvReads,
      kv_writes: kvWrites,
      kv_lists: kvLists,
      log_events: logEvents
    },
    costs_usd: {
      issuance_ai: round(issueAiCost),
      expected_monitoring_ai: round(expectedMonitoringAiCost),
      ai_total: round(aiCost),
      platform_marginal: round(platformCost),
      allocated_paid_plan_base: round(allocatedBasePlanCost),
      estimated_lifetime_total: round(estimatedLifetimeCostUsd)
    },
    pricing_usd: {
      break_even: round(breakEvenPriceUsd),
      target_at_margin: round(targetPriceUsd)
    },
    exclusions: [
      "KV stored-data charges",
      "source-origin charges outside Cloudflare",
      "payment/facilitator fees not represented in Cloudflare pricing",
      "taxes",
      "support/operations labor",
      "unmeasured CPU unless workerCpuMsPerLifecycle is supplied"
    ]
  };
}

function positiveNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function numberOrZero(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : 0;
}

function clamp(value, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return min;
  return Math.max(min, Math.min(max, number));
}

function round(value) {
  return Math.round(value * 1e12) / 1e12;
}
