import fs from 'node:fs'

// Release invariant suite for the persistent Foundry runtime.
const source = fs.readFileSync(new URL('../src/foundry.js', import.meta.url), 'utf8')
const worker = fs.readFileSync(new URL('../src/worker.js', import.meta.url), 'utf8')
const router = fs.readFileSync(new URL('../src/assistant-model-router.js', import.meta.url), 'utf8')
const migration = fs.readFileSync(new URL('../migrations/0016_foundry.sql', import.meta.url), 'utf8')
const wrangler = fs.readFileSync(new URL('../wrangler.jsonc', import.meta.url), 'utf8')

const checks = [
  [source.includes('getOptionalProofTTLSession') && source.includes('authentication_required'), 'Foundry browser routes require authenticated session'],
  [source.includes('RUN ISOLATION') && source.includes('ANTI-ANCHORING'), 'Foundry prompt blocks conversation anchoring'],
  [source.includes('executeStage') && source.includes('discoveryStep') && source.includes('judgeStep') && source.includes('challengeStep'), 'Foundry has bounded discovery/judge/challenge stages'],
  [source.includes('runFoundryScheduled') && source.includes("WHERE status='running'"), 'Foundry exposes durable scheduled advancement'],
  [source.includes('model_calls=model_calls+1') && source.includes('rounds_completed'), 'Foundry persists actual run progress instead of pretending runtime'],
  [source.includes('Do not claim web research') && source.includes('No invented statistics'), 'Foundry forbids fabricated research evidence'],
  [source.includes('rejected') && source.includes('red_team') && source.includes('evidence_confidence'), 'Foundry persists rejection and red-team judgments'],
  [migration.includes('foundry_runs') && migration.includes('foundry_candidates') && migration.includes('foundry_events'), 'Foundry D1 schema contains run, candidate, and event ledgers'],
  [migration.includes('REFERENCES foundry_runs(run_id) ON DELETE CASCADE'), 'Foundry child records have run foreign-key integrity'],
  [worker.includes('handleFoundry') && worker.includes('isFoundryPath') && worker.includes('applyAuthCors'), 'Foundry routes preserve authenticated browser CORS'],
  [worker.includes('runFoundryScheduled') && worker.includes('Promise.allSettled'), 'Existing cron advances Foundry without breaking core scheduled work'],
  [router.includes('foundryModelPreference') && router.includes('ProofTTL Foundry'), 'Foundry requests can route through a dedicated model council without changing ordinary L.O.V.E. routing'],
  [router.includes('hostile investment committee') && router.includes('CURRENT LEADERS='), 'Foundry council assigns distinct judge and challenger roles'],
  [wrangler.includes('@cf/meta/llama-3.3-70b-instruct-fp8-fast') && wrangler.includes('@cf/qwen/qwen3.8-27b') && wrangler.includes('@cf/zai-org/glm-4.7-flash'), 'Foundry cloud council is configured with three current Workers AI models'],
  [wrangler.includes('"main": "src/worker.js"'), 'Wrangler keeps canonical Worker entrypoint'],
]

const failed = checks.filter(([ok]) => !ok).map(([, label]) => label)
if (failed.length) throw new Error(`Foundry test failed: ${failed.join(', ')}`)
console.log(`Foundry test passed (${checks.length} invariants).`)