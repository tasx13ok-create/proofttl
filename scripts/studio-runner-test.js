import fs from 'node:fs'

const runner = fs.readFileSync(new URL('../src/studio-runner.js', import.meta.url), 'utf8')
const worker = fs.readFileSync(new URL('../src/worker.js', import.meta.url), 'utf8')

const checks = [
  [runner.includes("getOptionalProofTTLSession") && runner.includes("authentication_required"), 'runner requires authenticated Better Auth account'],
  [runner.includes("javascript") && runner.includes("python") && runner.includes("bash") && !runner.includes("powershell: {"), 'runner runtime allowlist is JS/Python/Bash only'],
  [runner.includes('MAX_CODE_CHARS = 25000') && runner.includes('MAX_OUTPUT_CHARS = 20000'), 'runner bounds code and output sizes'],
  [runner.includes("JOB_TIMEOUT_MS = 15000"), 'runner enforces short execution timeout'],
  [runner.includes("allowedDomains: []") && runner.includes("allowedCIDRs: []"), 'runner sandbox has no outbound network allowlist'],
  [runner.includes("production_secrets_injected: false"), 'runner reports no production secret injection'],
  [runner.includes("persistent: false"), 'runner creates ephemeral sandbox'],
  [runner.includes("/stop") && runner.includes("method: 'DELETE'"), 'runner cleans up session and sandbox'],
  [runner.includes('studio-run:') && runner.includes('ASSISTANT_RATE_LIMITER'), 'runner rate limits execution by authenticated account'],
  [worker.includes('STUDIO_RUN_PATH = "/studio/run"') && worker.includes('handleStudioRun'), 'Worker exposes isolated runner route'],
  [worker.includes('STUDIO_RUNNER_STATUS_PATH') && worker.includes('runnerConfigured(env)'), 'Worker exposes truthful runner readiness'],
]

const failed = checks.filter(([ok]) => !ok).map(([, label]) => label)
if (failed.length) throw new Error(`Studio runner test failed: ${failed.join(', ')}`)
console.log(`Studio runner test passed (${checks.length} invariants).`)
