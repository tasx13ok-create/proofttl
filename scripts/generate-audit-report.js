import { readFile, writeFile } from 'node:fs/promises'
import { basename, resolve } from 'node:path'

function usage() {
  console.error('Usage: node scripts/generate-audit-report.js <leases.json> [output.md]')
  process.exitCode = 1
}

function asArray(value) {
  if (Array.isArray(value)) return value
  if (value && Array.isArray(value.leases)) return value.leases
  if (value && typeof value === 'object' && value.lease_id) return [value]
  return []
}

function clean(value, fallback = '—') {
  if (value === null || value === undefined || value === '') return fallback
  return String(value).replace(/\s+/g, ' ').trim()
}

function scoreSummary(leases) {
  const summary = { SUPPORTED: 0, CONTRADICTED: 0, UNKNOWN: 0, ACTIVE: 0, REVOKED: 0, EXPIRED: 0 }
  for (const lease of leases) {
    if (summary[lease.status] !== undefined) summary[lease.status] += 1
    if (summary[lease.lease_state] !== undefined) summary[lease.lease_state] += 1
  }
  return summary
}

function leaseSection(lease, index) {
  const evidence = clean(lease.evidence)
  const reason = clean(lease.reason)
  const signature = lease.signature
    ? `${clean(lease.signature.algorithm)} · key ${clean(lease.signature.key_id)}`
    : 'Not present in supplied record'

  return [
    `## ${index + 1}. ${clean(lease.claim)}`,
    '',
    `**Verdict:** ${clean(lease.status)}`,
    `**Lease state:** ${clean(lease.lease_state)}`,
    `**Confidence:** ${clean(lease.confidence)}`,
    `**Source:** ${clean(lease.final_url || lease.source_url)}`,
    `**Issued:** ${clean(lease.issued_at)}`,
    `**Expires:** ${clean(lease.expires_at)}`,
    `**Lease ID:** \`${clean(lease.lease_id)}\``,
    `**Source fingerprint:** \`${clean(lease.source_fingerprint)}\``,
    `**Signature:** ${signature}`,
    '',
    '**Evidence**',
    '',
    `> ${evidence}`,
    '',
    '**Reason**',
    '',
    reason,
    '',
  ].join('\n')
}

function buildReport(leases, sourceName) {
  const summary = scoreSummary(leases)
  const generatedAt = new Date().toISOString()

  return [
    '# ProofTTL Verification Audit',
    '',
    `Generated: ${generatedAt}`,
    `Input: ${sourceName}`,
    `Claims audited: ${leases.length}`,
    '',
    '## Executive summary',
    '',
    `- SUPPORTED: ${summary.SUPPORTED}`,
    `- CONTRADICTED: ${summary.CONTRADICTED}`,
    `- UNKNOWN: ${summary.UNKNOWN}`,
    `- ACTIVE leases: ${summary.ACTIVE}`,
    `- REVOKED leases: ${summary.REVOKED}`,
    `- EXPIRED leases: ${summary.EXPIRED}`,
    '',
    'ProofTTL reports what the supplied source evidence supports at the time each Fact Lease was issued or last checked. Fact Leases are time-bound and can later expire or be revoked when monitored evidence no longer maintains the issued verdict.',
    '',
    ...leases.map(leaseSection),
    '---',
    '',
    'This audit is an evidence-verification deliverable, not legal, financial, medical, or regulatory advice.',
    '',
  ].join('\n')
}

const [, , inputArg, outputArg] = process.argv
if (!inputArg) {
  usage()
} else {
  const inputPath = resolve(inputArg)
  const outputPath = resolve(outputArg || inputArg.replace(/\.json$/i, '') + '-audit.md')
  const parsed = JSON.parse(await readFile(inputPath, 'utf8'))
  const leases = asArray(parsed)

  if (!leases.length) {
    throw new Error('Input must contain a Fact Lease object, an array of Fact Leases, or { "leases": [...] }.')
  }

  const report = buildReport(leases, basename(inputPath))
  await writeFile(outputPath, report, 'utf8')
  console.log(`ProofTTL audit report written to ${outputPath}`)
  console.log(`Claims: ${leases.length}`)
}
