import assert from 'node:assert/strict';
import {
  aggregateObservations,
  evaluateMiraCandidate,
  miraScore,
  proposeMiraImprovements
} from '../src/mira.js';

function sample({ count = 20, success = true, latency = 400, reliability = 0.995, prompt = 300, retries = 0, cost = 0.2, quality = 0.98 } = {}) {
  return Array.from({ length: count }, () => ({
    task_class: 'assistant_chat',
    strategy_id: 'test',
    model_id: '@cf/ibm-granite/granite-4.0-h-micro',
    success,
    latency_ms: latency,
    reliability_score: reliability,
    prompt_tokens: prompt,
    completion_tokens: 90,
    retries,
    cost_units: cost,
    quality_score: quality
  }));
}

const baseline = sample({ latency: 700, prompt: 600, cost: 0.5, quality: 0.96 });
const better = sample({ latency: 350, prompt: 300, cost: 0.2, quality: 0.97 });

const result = evaluateMiraCandidate({ baseline, candidate: better });
assert.equal(result.status, 'SUPPORTED');
assert.equal(result.promotable, true);
assert.ok(result.candidate_score > result.baseline_score);

const unsafe = sample({ reliability: 0.9, latency: 100, prompt: 100, cost: 0.05, quality: 1 });
const unsafeResult = evaluateMiraCandidate({ baseline, candidate: unsafe });
assert.equal(unsafeResult.status, 'REJECTED');
assert.equal(unsafeResult.reason, 'reliability_floor_failed');

const tooSmall = evaluateMiraCandidate({ baseline: baseline.slice(0, 5), candidate: better.slice(0, 5) });
assert.equal(tooSmall.status, 'TESTING');
assert.equal(tooSmall.promotable, false);

const noisy = sample({ latency: 1100, prompt: 900, retries: 1, reliability: 0.97 });
const proposals = proposeMiraImprovements(noisy);
assert.ok(proposals.some((proposal) => proposal.target === 'reduce_retry_rate'));
assert.ok(proposals.some((proposal) => proposal.target === 'reduce_latency'));
assert.ok(proposals.some((proposal) => proposal.target === 'reduce_prompt_tokens'));
assert.ok(proposals.some((proposal) => proposal.target === 'increase_reliability'));

const aggregate = aggregateObservations(better);
assert.equal(aggregate.count, 20);
assert.ok(miraScore(aggregate) > 0);

console.log('MIRA safety and promotion checks passed');
