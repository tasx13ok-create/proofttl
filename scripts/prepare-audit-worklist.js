import { readFile, writeFile } from 'node:fs/promises'
import { basename, resolve } from 'node:path'

const DEFAULT_TTL_SECONDS = 604800
const PRIORITY_ORDER = { critical: 0, high: 1, medium: 2, low: 3 }

function usage() {
  console.error('Usage: node scripts/prepare-audit-worklist.js <candidates.json> [output.json] [ttl_seconds]')
  process.exitCode = 1
}

function clean(value) {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : ''
}

function assertHttpUrl(value, id) {
  let parsed
  try {
    parsed = new URL(value)
  } catch {
    throw new Error(`${id}: source_url must be a valid URL`)
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new Error(`${id}: source_url must use http(s)`)
  }
  return parsed.toString()
}

function normalizeCandidate(candidate, index, ttlSeconds) {
  const id = clean(candidate?.id) || `CLAIM-${String(index + 1).padStart(3, '0')}`
  const claim = clean(candidate?.claim)
  if (!claim) throw new Error(`${id}: claim is required`)
  if (claim.length > 1000) throw new Error(`${id}: claim exceeds 1000 characters`)

  const sourceUrl = assertHttpUrl(clean(candidate?.source_url), id)
  const priority = clean(candidate?.monitoring_priority).toLowerCase() || 'medium'
  if (!(priority in PRIORITY_ORDER)) {
    throw new Error(`${id}: monitoring_priority must be critical, high, medium, or low`)
  }

  return {
    audit_claim_id: id,
    claim,
    source_url: sourceUrl,
    source_type: clean(candidate?.source_type) || 'unspecified',
    expected_role: clean(candidate?.expected_role) || 'unspecified',
    monitoring_priority: priority,
    analyst_notes: clean(candidate?.notes),
    verification_request: {
      claim,
      source_url: sourceUrl,
      ttl_seconds: ttlSeconds
    },
    review: {
      exact_evidence_span_required: true,
      source_access_time_required: true,
      conflicting_evidence_review_required: true,
      final_verdict: null,
      risk_level: null,
      recommendation: null,
      historical_context: null,
      counter_evidence: []
    }
  }
}

const [, , inputArg, outputArg, ttlArg] = process.argv
if (!inputArg) {
  usage()
} else {
  const ttlSeconds = ttlArg === undefined ? DEFAULT_TTL_SECONDS : Number(ttlArg)
  if (!Number.isInteger(ttlSeconds) || ttlSeconds < 60 || ttlSeconds > 604800) {
    throw new Error('ttl_seconds must be a whole number from 60 to 604800')
  }

  const inputPath = resolve(inputArg)
  const outputPath = resolve(outputArg || inputArg.replace(/\.json$/i, '') + '-worklist.json')
  const parsed = JSON.parse(await readFile(inputPath, 'utf8'))
  const candidates = Array.isArray(parsed?.candidates) ? parsed.candidates : []
  if (!candidates.length) throw new Error('Candidate file must contain a non-empty candidates array')

  const worklist = candidates
    .map((candidate, index) => normalizeCandidate(candidate, index, ttlSeconds))
    .sort((a, b) => PRIORITY_ORDER[a.monitoring_priority] - PRIORITY_ORDER[b.monitoring_priority])

  const prepared = {
    schema_version: 'proofttl.audit-worklist.v1',
    generated_at: new Date().toISOString(),
    source_file: basename(inputPath),
    report_target: parsed.report_target || null,
    research_rules: Array.isArray(parsed.research_rules) ? parsed.research_rules : [],
    ttl_seconds: ttlSeconds,
    claim_count: worklist.length,
    worklist
  }

  await writeFile(outputPath, JSON.stringify(prepared, null, 2) + '\n', 'utf8')
  console.log(`ProofTTL audit worklist written to ${outputPath}`)
  console.log(`Claims: ${worklist.length}`)
  console.log(`TTL: ${ttlSeconds} seconds`)
}