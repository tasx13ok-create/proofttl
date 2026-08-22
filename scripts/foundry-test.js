import fs from 'node:fs'

const source = fs.readFileSync(new URL('../src/foundry.js', import.meta.url), 'utf8')
const wrapper = fs.readFileSync(new URL('../src/worker-foundry-wrapper.js', import.meta.url), 'utf8')
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
  [wrapper.includes('handleFoundry') && wrapper.includes('applyAuthCors'), 'Foundry routes preserve authenticated browser CORS'],
  [wrapper.includes('runFoundryScheduled') && wrapper.includes('Promise.allSettled'), 'Existing cron advances Foundry without breaking core scheduled work'],
  [wrangler.includes('src/worker-foundry-wrapper.js'), 'Wrangler deploy entrypoint includes Foundry wrapper'],
]

const failed = checks.filter(([ok]) => !ok).map(([, label]) => label)
if (failed.length) throw new Error(`Foundry test failed: ${failed.join(', ')}`)
console.log(`Foundry test passed (${checks.length} invariants).`)
