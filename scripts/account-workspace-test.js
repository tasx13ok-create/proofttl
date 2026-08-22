import fs from 'node:fs'

const source = fs.readFileSync(new URL('../src/account-workspace.js', import.meta.url), 'utf8')
const worker = fs.readFileSync(new URL('../src/worker.js', import.meta.url), 'utf8')
const migration = fs.readFileSync(new URL('../migrations/0011_account_workspace.sql', import.meta.url), 'utf8')
const intake = fs.readFileSync(new URL('../src/audit-intake.js', import.meta.url), 'utf8')

const checks = [
  [source.includes('getOptionalProofTTLSession') && source.includes('authentication_required'), 'workspace requires Better Auth session'],
  [source.includes('session?.user?.id') && source.includes('WHERE user_id=?'), 'workspace data is scoped to authenticated user id'],
  [source.includes('isProofTTLOwnerSession') && source.includes('unlimited_project_count'), 'owner Studio project listing is not capped by ordinary account quota'],
  [source.includes('MAX_PROJECT_BYTES') && source.includes('too_many_files') && source.includes('invalid_project_file'), 'project payload/file safety limits remain enforced'],
  [source.includes('audit_ownership_mismatch') && source.includes('normalizeEmail(intake.email) !== userEmail'), 'audit claiming requires signed-in email match'],
  [source.includes('JOIN audit_intakes a ON a.id = l.intake_id'), 'account audit list joins canonical audit_intakes.id key'],
  [source.includes('SELECT id,email FROM audit_intakes WHERE id=?'), 'audit claim lookup uses canonical audit_intakes.id key'],
  [source.includes('amount_due_usd') && source.includes('payment_state'), 'account audit list uses canonical commercial payment fields'],
  [migration.includes('account_preferences') && migration.includes('studio_projects') && migration.includes('account_audit_links'), 'account workspace migration complete'],
  [migration.includes('REFERENCES audit_intakes(id) ON DELETE CASCADE'), 'audit ownership links have canonical foreign-key integrity'],
  [worker.includes('ACCOUNT_AUDITS_PATH') && worker.includes('STUDIO_PROJECTS_PATH') && worker.includes('handleAccountWorkspace'), 'credentialed workspace routes wired through Worker'],
  [worker.includes('authPreflightResponse') && worker.includes('applyAuthCors'), 'credentialed browser CORS path preserved'],
  [intake.includes('sessionEmail === email') && intake.includes('account_audit_links'), 'new signed-in audit intake auto-link requires matching provider email'],
]

const failed = checks.filter(([ok]) => !ok).map(([, label]) => label)
if (failed.length) throw new Error(`Account workspace test failed: ${failed.join(', ')}`)
console.log(`Account workspace test passed (${checks.length} invariants).`)
