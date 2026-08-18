const DEFAULT_WEIGHTS = Object.freeze({
  quality: 0.45,
  reliability: 0.35,
  latency: 0.12,
  cost: 0.08
});

const DEFAULT_RELIABILITY_FLOOR = 0.98;
const DEFAULT_MIN_EVIDENCE = 20;

export function miraScore(metrics, options = {}) {
  const weights = { ...DEFAULT_WEIGHTS, ...(options.weights || {}) };
  const quality = clamp01(metrics?.quality_score ?? (metrics?.success ? 1 : 0));
  const reliability = clamp01(metrics?.reliability_score ?? (metrics?.success ? 1 : 0));
  const latencyEfficiency = inverseEfficiency(metrics?.latency_ms, options.latency_target_ms ?? 800);
  const costEfficiency = inverseEfficiency(metrics?.cost_units, options.cost_target_units ?? 1);

  return round6(
    weights.quality * quality +
    weights.reliability * reliability +
    weights.latency * latencyEfficiency +
    weights.cost * costEfficiency
  );
}

export function evaluateMiraCandidate({ baseline, candidate, reliabilityFloor = DEFAULT_RELIABILITY_FLOOR, minEvidence = DEFAULT_MIN_EVIDENCE }) {
  const baselineAggregate = aggregateObservations(baseline);
  const candidateAggregate = aggregateObservations(candidate);

  if (candidateAggregate.count < minEvidence || baselineAggregate.count < minEvidence) {
    return {
      status: 'TESTING',
      promotable: false,
      reason: 'insufficient_evidence',
      baseline: baselineAggregate,
      candidate: candidateAggregate
    };
  }

  if (candidateAggregate.reliability < reliabilityFloor) {
    return {
      status: 'REJECTED',
      promotable: false,
      reason: 'reliability_floor_failed',
      baseline: baselineAggregate,
      candidate: candidateAggregate
    };
  }

  const baselineScore = miraScore(baselineAggregate);
  const candidateScore = miraScore(candidateAggregate);
  const promotable = candidateScore > baselineScore;

  return {
    status: promotable ? 'SUPPORTED' : 'REJECTED',
    promotable,
    reason: promotable ? 'candidate_outperformed_baseline' : 'candidate_did_not_outperform_baseline',
    baseline_score: baselineScore,
    candidate_score: candidateScore,
    delta: round6(candidateScore - baselineScore),
    baseline: baselineAggregate,
    candidate: candidateAggregate
  };
}

export function proposeMiraImprovements(observations = []) {
  const aggregate = aggregateObservations(observations);
  const proposals = [];

  if (!aggregate.count) return proposals;

  if (aggregate.retry_rate > 0.05) {
    proposals.push({
      type: 'reliability',
      hypothesis: 'Add a cheaper deterministic precheck or alternate response parser before retrying the model.',
      target: 'reduce_retry_rate'
    });
  }

  if (aggregate.average_latency_ms > 900) {
    proposals.push({
      type: 'latency',
      hypothesis: 'Reduce context size or route low-complexity tasks to a lighter strategy before model inference.',
      target: 'reduce_latency'
    });
  }

  if (aggregate.average_prompt_tokens > 700) {
    proposals.push({
      type: 'cost',
      hypothesis: 'Compress conversation context while preserving the most recent task-relevant turns.',
      target: 'reduce_prompt_tokens'
    });
  }

  if (aggregate.reliability < 0.99) {
    proposals.push({
      type: 'reliability',
      hypothesis: 'Introduce an output validation gate and escalate only invalid or low-confidence responses.',
      target: 'increase_reliability'
    });
  }

  return proposals;
}

export async function recordMiraObservation(env, observation) {
  if (!env?.MONITOR_DB || typeof env.MONITOR_DB.prepare !== 'function') return false;

  const row = normalizeObservation(observation);
  try {
    await env.MONITOR_DB.prepare(
      `INSERT INTO mira_observation (
        created_at_ms, task_class, strategy_id, model_id, success, latency_ms,
        prompt_tokens, completion_tokens, retries, quality_score, reliability_score,
        cost_units, metadata_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      row.created_at_ms,
      row.task_class,
      row.strategy_id,
      row.model_id,
      row.success ? 1 : 0,
      row.latency_ms,
      row.prompt_tokens,
      row.completion_tokens,
      row.retries,
      row.quality_score,
      row.reliability_score,
      row.cost_units,
      row.metadata_json
    ).run();
    return true;
  } catch (error) {
    console.warn(JSON.stringify({
      event: 'mira_observation_write_failed',
      error: error?.name || error?.constructor?.name || 'Error'
    }));
    return false;
  }
}

export function normalizeObservation(observation = {}) {
  const success = Boolean(observation.success);
  return {
    created_at_ms: finiteInt(observation.created_at_ms, Date.now()),
    task_class: cleanText(observation.task_class, 'unknown', 80),
    strategy_id: cleanText(observation.strategy_id, 'unknown', 120),
    model_id: cleanNullableText(observation.model_id, 160),
    success,
    latency_ms: Math.max(0, finiteInt(observation.latency_ms, 0)),
    prompt_tokens: finiteNullableInt(observation.prompt_tokens),
    completion_tokens: finiteNullableInt(observation.completion_tokens),
    retries: Math.max(0, finiteInt(observation.retries, 0)),
    quality_score: finiteNullableNumber(observation.quality_score),
    reliability_score: clamp01(observation.reliability_score ?? (success ? 1 : 0)),
    cost_units: finiteNullableNumber(observation.cost_units),
    metadata_json: safeJson(observation.metadata)
  };
}

export function aggregateObservations(observations = []) {
  const rows = observations.map(normalizeObservation);
  const count = rows.length;
  if (!count) {
    return {
      count: 0,
      success: false,
      quality_score: 0,
      reliability_score: 0,
      reliability: 0,
      latency_ms: 0,
      average_latency_ms: 0,
      average_prompt_tokens: 0,
      average_completion_tokens: 0,
      retry_rate: 0,
      cost_units: 0
    };
  }

  const successCount = rows.filter((row) => row.success).length;
  const promptRows = rows.filter((row) => Number.isFinite(row.prompt_tokens));
  const completionRows = rows.filter((row) => Number.isFinite(row.completion_tokens));
  const qualityRows = rows.filter((row) => Number.isFinite(row.quality_score));
  const costRows = rows.filter((row) => Number.isFinite(row.cost_units));

  const reliability = average(rows.map((row) => row.reliability_score));
  const averageLatency = average(rows.map((row) => row.latency_ms));
  const averageCost = costRows.length ? average(costRows.map((row) => row.cost_units)) : 0;

  return {
    count,
    success: successCount === count,
    success_rate: successCount / count,
    quality_score: qualityRows.length ? average(qualityRows.map((row) => row.quality_score)) : successCount / count,
    reliability_score: reliability,
    reliability,
    latency_ms: averageLatency,
    average_latency_ms: averageLatency,
    average_prompt_tokens: promptRows.length ? average(promptRows.map((row) => row.prompt_tokens)) : 0,
    average_completion_tokens: completionRows.length ? average(completionRows.map((row) => row.completion_tokens)) : 0,
    retry_rate: rows.filter((row) => row.retries > 0).length / count,
    cost_units: averageCost
  };
}

function inverseEfficiency(value, target) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return 1;
  const safeTarget = Math.max(1e-9, Number(target) || 1);
  return clamp01(safeTarget / numeric);
}

function average(values) {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + Number(value || 0), 0) / values.length;
}

function clamp01(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.max(0, Math.min(1, number));
}

function finiteInt(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.trunc(number) : fallback;
}

function finiteNullableInt(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.trunc(number)) : null;
}

function finiteNullableNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function cleanText(value, fallback, maxLength) {
  const text = typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
  return (text || fallback).slice(0, maxLength);
}

function cleanNullableText(value, maxLength) {
  const text = typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
  return text ? text.slice(0, maxLength) : null;
}

function safeJson(value) {
  if (value === undefined) return null;
  try {
    return JSON.stringify(value).slice(0, 8000);
  } catch {
    return null;
  }
}

function round6(value) {
  return Math.round(Number(value) * 1e6) / 1e6;
}

export const MIRA_DEFAULTS = Object.freeze({
  weights: DEFAULT_WEIGHTS,
  reliabilityFloor: DEFAULT_RELIABILITY_FLOOR,
  minEvidence: DEFAULT_MIN_EVIDENCE
});
