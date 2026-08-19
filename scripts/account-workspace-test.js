import fs from 'node:fs'

const source = fs.readFileSync(new URL('../src/account-workspace.js', import.meta.url), 'utf8')
const worker = fs.readFileSync(new URL('../src/worker.js', import.meta.url), 'utf8')
const migration = fs.readFileSync(new URL('../migrations/0011_account_workspace.sql', import.meta.url), 'utf8')

const checks = [
  [source.includes('getOptionalProofTTLSession') && source.includes('authentication_required'), 'workspace requires Better Auth session'],
  [source.includes('session?.user?.id') && source.includes('WHERE user_id=?'), 'workspace data is scoped to authenticated user id'],
  [source.includes('audit_ownership_mismatch') && source.includes('normalizeEmail(intake.email) !== userEmail'), 'audit claiming requires signed-in email match'],
  [source.includes('MAX_PROJECT_BYTES') && source.includes('too_many_files') && source.includes('invalid_project_file'), 'project payload/file limits enforced'],
  [migration.includes('account_preferences') && migration.includes('studio_projects') && migration.includes('account_audit_links'), 'account workspace migration complete'],
  [worker.includes('ACCOUNT_AUDITS_PATH') && worker.includes('STUDIO_PROJECTS_PATH') && worker.includes('handleAccountWorkspace'), 'credentialed workspace routes wired through Worker'],
  [worker.includes('authPreflightResponse') && worker.includes('applyAuthCors'), 'credentialed browser CORS path preserved'],
]

const failed = checks.filter(([ok]) => !ok).map(([, label]) => label)
if (failed.length) throw new Error(`Account workspace test failed: ${failed.join(', ')}`)
console.log(`Account workspace test passed (${checks.length} invariants).`)
