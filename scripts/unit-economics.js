import { estimateLeaseEconomics } from "../src/economics.js";

const args = parseArgs(process.argv.slice(2));

const input = {
  promptTokens: args.prompt ?? 0,
  completionTokens: args.completion ?? 0,
  ttlSeconds: args.ttl ?? 3600,
  monitorIntervalSeconds: args.interval ?? null,
  sourceChangeRatePerCheck: args.changeRate ?? 0,
  activeLeasesSharingMonitor: args.activeLeases ?? 1,
  targetGrossMargin: args.margin ?? 0.8,
  monthlyPaidVerifications: args.monthlyVolume ?? 0,
  workerCpuMsPerLifecycle: args.cpuMs ?? 0
};

const result = estimateLeaseEconomics(input);

console.log("ProofTTL unit economics estimate\n");
console.log(`AI tokens at issuance: ${Number(input.promptTokens).toLocaleString()} prompt + ${Number(input.completionTokens).toLocaleString()} completion`);
console.log(`TTL: ${result.assumptions.ttl_seconds}s`);
console.log(`Monitor interval: ${result.assumptions.monitor_interval_seconds}s`);
console.log(`Expected source-change probability/check: ${(result.assumptions.source_change_rate_per_check * 100).toFixed(2)}%`);
console.log(`Active leases sharing monitor overhead: ${result.assumptions.active_leases_sharing_monitor}`);
console.log(`Target gross margin: ${(result.assumptions.target_gross_margin * 100).toFixed(1)}%\n`);

console.log("Expected lifecycle work:");
console.log(`  automatic source checks: ${format(result.operations.expected_monitor_checks)}`);
console.log(`  semantic rechecks from source changes: ${format(result.operations.expected_changed_source_checks)}`);
console.log(`  allocated minute-monitor runs: ${format(result.operations.allocated_monitor_runs)}`);
console.log(`  KV reads/writes/lists: ${format(result.operations.kv_reads)} / ${format(result.operations.kv_writes)} / ${format(result.operations.kv_lists)}\n`);

console.log("Estimated USD cost:");
console.log(`  issuance AI:             ${money(result.costs_usd.issuance_ai)}`);
console.log(`  expected monitoring AI: ${money(result.costs_usd.expected_monitoring_ai)}`);
console.log(`  platform marginal:      ${money(result.costs_usd.platform_marginal)}`);
console.log(`  allocated $5 base plan: ${money(result.costs_usd.allocated_paid_plan_base)}`);
console.log(`  lifetime total:         ${money(result.costs_usd.estimated_lifetime_total)}\n`);

console.log(`BREAK-EVEN PRICE: ${money(result.pricing_usd.break_even)}`);
console.log(`TARGET PRICE @ ${(result.assumptions.target_gross_margin * 100).toFixed(0)}% GROSS MARGIN: ${money(result.pricing_usd.target_at_margin)}\n`);

console.log("This is a pricing model, not a bill forecast. It deliberately exposes assumptions and excludes unmeasured costs listed below:");
for (const exclusion of result.exclusions) console.log(`  - ${exclusion}`);

function parseArgs(values) {
  const aliases = {
    "--prompt": "prompt",
    "--completion": "completion",
    "--ttl": "ttl",
    "--interval": "interval",
    "--change-rate": "changeRate",
    "--active-leases": "activeLeases",
    "--margin": "margin",
    "--monthly-volume": "monthlyVolume",
    "--cpu-ms": "cpuMs"
  };

  const parsed = {};
  for (let i = 0; i < values.length; i += 1) {
    const key = aliases[values[i]];
    if (!key) continue;
    const raw = values[i + 1];
    if (raw === undefined) throw new Error(`Missing value for ${values[i]}`);
    const value = Number(raw);
    if (!Number.isFinite(value)) throw new Error(`Invalid numeric value for ${values[i]}: ${raw}`);
    parsed[key] = value;
    i += 1;
  }
  return parsed;
}

function money(value) {
  return `$${Number(value).toFixed(8)}`;
}

function format(value) {
  return Number.isInteger(value) ? String(value) : Number(value).toFixed(4);
}
