import { readFile, writeFile } from 'node:fs/promises'
import { basename, resolve } from 'node:path'
import { createHash } from 'node:crypto'

function usage() {
  console.error('Usage: node scripts/generate-audit-report.js <leases.json> [output.md]')
  process.exitCode = 1
}

function unpack(value) {
  if (Array.isArray(value)) return { leases: value, report: {} }
  if (value && Array.isArray(value.leases)) return { leases: value.leases, report: value.report || {} }
  if (value && typeof value === 'object' && value.lease_id) return { leases: [value], report: {} }
  return { leases: [], report: {} }
}

function clean(value, fallback = '—') {
  if (value === null || value === undefined || value === '') return fallback
  return String(value).replace(/\s+/g, ' ').trim()
}

function mdCell(value) {
  return clean(value).replace(/\|/g, '\\|')
}

function scoreSummary(leases) {
  const summary = { SUPPORTED: 0, CONTRADICTED: 0, UNKNOWN: 0, ACTIVE: 0, REVOKED: 0, EXPIRED: 0 }
  for (const lease of leases) {
    if (summary[lease.status] !== undefined) summary[lease.status] += 1
    if (summary[lease.lease_state] !== undefined) summary[lease.lease_state] += 1
  }
  return summary
}

function reportId(report, leases, generatedAt) {
  if (report.report_id) return clean(report.report_id)
  const digest = createHash('sha256')
    .update(JSON.stringify(leases.map((lease) => [lease.lease_id, lease.claim, lease.status])))
    .update(generatedAt)
    .digest('hex')
    .slice(0, 12)
    .toUpperCase()
  return `PTTL-${digest}`
}

function riskOf(lease) {
  return clean(lease.audit?.risk || lease.risk, 'UNRATED').toUpperCase()
}

function actionOf(lease) {
  return clean(lease.audit?.recommended_action || lease.recommended_action, 'Review evidence and decide whether this claim should remain in use.')
}

function sourceTypeOf(lease) {
  return clean(lease.audit?.source_type || lease.source_type, 'unspecified')
}

function dashboard(leases) {
  const rows = leases.map((lease, index) => {
    const drift = lease.audit?.drift_note || lease.drift_note || '—'
    return `| ${index + 1} | ${mdCell(lease.claim)} | ${mdCell(lease.status)} | ${mdCell(riskOf(lease))} | ${mdCell(lease.lease_state)} | ${mdCell(drift)} |`
  })

  return [
    '## Risk & drift dashboard',
    '',
    '| # | Claim | Verdict | Risk | Lease state | Drift / monitoring note |',
    '|---:|---|---|---|---|---|',
    ...rows,
    '',
  ].join('\n')
}

function leaseSection(lease, index) {
  const evidence = clean(lease.evidence)
  const reason = clean(lease.reason)
  const signature = lease.signature
    ? `${clean(lease.signature.algorithm)} · key ${clean(lease.signature.key_id)}`
    : 'Not present in supplied record'
  const sourceUrl = clean(lease.final_url || lease.source_url)
  const accessTime = clean(lease.audit?.source_accessed_at || lease.source_accessed_at || lease.last_checked_at || lease.issued_at)
  const historicalContext = clean(lease.audit?.historical_context || lease.historical_context, '')
  const conflictingEvidence = clean(lease.audit?.conflicting_evidence || lease.conflicting_evidence, '')

  return [
    `## ${index + 1}. ${clean(lease.claim)}`,
    '',
    `**Verdict:** ${clean(lease.status)}`,
    `**Business risk:** ${riskOf(lease)}`,
    `**Recommended action:** ${actionOf(lease)}`,
    `**Lease state:** ${clean(lease.lease_state)}`,
    `**Confidence:** ${clean(lease.confidence)}`,
    `**Source type:** ${sourceTypeOf(lease)}`,
    `**Source:** ${sourceUrl}`,
    `**Source accessed / checked:** ${accessTime}`,
    `**Issued:** ${clean(lease.issued_at)}`,
    `**Expires:** ${clean(lease.expires_at)}`,
    `**Lease ID:** \`${clean(lease.lease_id)}\``,
    `**Source fingerprint:** \`${clean(lease.source_fingerprint)}\``,
    `**Signature:** ${signature}`,
    '',
    '**Evidence span**',
    '',
    `> ${evidence}`,
    '',
    '**Why this verdict follows from the evidence**',
    '',
    reason,
    ...(historicalContext ? ['', '**Time / historical context**', '', historicalContext] : []),
    ...(conflictingEvidence ? ['', '**Conflicting or counter-evidence considered**', '', conflictingEvidence] : []),
    '',
  ].join('\n')
}

function sourceIndex(leases) {
  const seen = new Set()
  const rows = []
  for (const lease of leases) {
    const url = clean(lease.final_url || lease.source_url, '')
    if (!url || seen.has(url)) continue
    seen.add(url)
    rows.push({
      url,
      type: sourceTypeOf(lease),
      accessed: clean(lease.audit?.source_accessed_at || lease.source_accessed_at || lease.last_checked_at || lease.issued_at),
    })
  }

  return [
    '## Source index',
    '',
    '| Source | Type | Accessed / checked |',
    '|---|---|---|',
    ...rows.map((row) => `| ${mdCell(row.url)} | ${mdCell(row.type)} | ${mdCell(row.accessed)} |`),
    '',
  ].join('\n')
}

function buildReport(leases, report, sourceName) {
  const summary = scoreSummary(leases)
  const generatedAt = new Date().toISOString()
  const id = reportId(report, leases, generatedAt)
  const title = clean(report.title, 'ProofTTL Verification Audit')
  const subject = clean(report.subject, 'Public sample')
  const version = clean(report.version, '1.0')
  const recommendation = clean(report.executive_recommendation, 'Review contradicted and unknown claims first; retain time-bound monitoring for claims whose sources, prices, models, policies, or availability can change.')

  return [
    `# ${title}`,
    '',
    `**Subject:** ${subject}`,
    `**Report ID:** ${id}`,
    `**Version:** ${version}`,
    `**Generated:** ${generatedAt}`,
    `**Input:** ${sourceName}`,
    `**Claims audited:** ${leases.length}`,
    '',
    '> This report records what the cited evidence supports at a particular time. It does not convert a source assertion into absolute truth, and it does not imply endorsement of or affiliation with the audited subject.',
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
    `**Recommended action:** ${recommendation}`,
    '',
    'ProofTTL separates two questions that are often collapsed: (1) whether a source supports a precise claim at evaluation time, and (2) whether that verification should still be relied upon later. Fact Leases are time-bound so monitored evidence can expire or trigger a changed state instead of leaving a stale verdict looking permanently valid.',
    '',
    dashboard(leases),
    ...leases.map(leaseSection),
    '## Methodology & limitations',
    '',
    '- Claims should be precise, falsifiable, and evaluated against the exact cited evidence rather than search snippets or model summaries.',
    '- Primary sources are preferred for product, pricing, feature, policy, and first-party statements. A first-party source supporting its own statement is not the same as independent validation of real-world performance.',
    '- CONTRADICTED should be used only when evidence directly negates the precise claim. UNKNOWN means the supplied evidence does not settle the claim; it does not mean the claim is false.',
    '- Source access/check times matter. Product pages, models, prices, policies, and documentation can change after issuance.',
    '- Automated verification can miss context, ambiguity, inaccessible content, or changes outside the monitored source. Material or disputed findings should receive human review.',
    '- This sample is not legal, financial, medical, regulatory, certification, or compliance advice and is not a substitute for primary due diligence.',
    '',
    sourceIndex(leases),
    '---',
    '',
    'ProofTTL evidence-verification deliverable. No guarantee of completeness or absolute accuracy is made.',
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
  const { leases, report } = unpack(parsed)

  if (!leases.length) {
    throw new Error('Input must contain a Fact Lease object, an array of Fact Leases, or { "leases": [...], "report": {...} }.')
  }

  const output = buildReport(leases, report, basename(inputPath))
  await writeFile(outputPath, output, 'utf8')
  console.log(`ProofTTL audit report written to ${outputPath}`)
  console.log(`Claims: ${leases.length}`)
}
