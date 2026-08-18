import { readFile, writeFile } from 'node:fs/promises'
import { basename, resolve } from 'node:path'
import { x402Client, wrapFetchWithPayment } from '@x402/fetch'
import { ExactEvmScheme } from '@x402/evm/exact/client'
import { privateKeyToAccount } from 'viem/accounts'

const DEFAULT_ENDPOINT = 'https://proofttl.tasx13ok.workers.dev/verify'
const EXPECTED_NETWORK = 'eip155:84532'
const EXPECTED_PAY_TO = '0x29949a066902bd329F74479c9AEBC448100955d8'.toLowerCase()
const MAX_ATOMIC_USDC_PER_CLAIM = 10000n // $0.01 hard ceiling per claim
const CONFIRM_VALUE = 'YES'

function usage() {
  console.error('Usage: node scripts/run-audit-batch.js <worklist.json> [output.json]')
  console.error(`Set PROOFTTL_AUDIT_CONFIRM=${CONFIRM_VALUE} to authorize payments after all preflights pass.`)
  process.exitCode = 1
}

function decodePaymentRequired(header) {
  try {
    return JSON.parse(Buffer.from(header, 'base64').toString('utf8'))
  } catch {
    return null
  }
}

function acceptedTerms(paymentRequired) {
  if (!Array.isArray(paymentRequired?.accepts)) return null
  return paymentRequired.accepts.find(option => {
    if (option?.scheme !== 'exact') return false
    if (option?.network !== EXPECTED_NETWORK) return false
    if (String(option?.payTo ?? '').toLowerCase() !== EXPECTED_PAY_TO) return false
    try {
      const amount = BigInt(option?.amount ?? '-1')
      return amount >= 0n && amount <= MAX_ATOMIC_USDC_PER_CLAIM
    } catch {
      return false
    }
  }) || null
}

function normalizeWorklist(parsed) {
  const items = Array.isArray(parsed?.worklist) ? parsed.worklist : []
  if (!items.length) throw new Error('Worklist must contain a non-empty worklist array')

  return items.map((item, index) => {
    const request = item?.verification_request
    if (!request || typeof request !== 'object') {
      throw new Error(`Worklist item ${index + 1} is missing verification_request`)
    }
    if (typeof request.claim !== 'string' || !request.claim.trim()) {
      throw new Error(`Worklist item ${index + 1} is missing claim`)
    }
    if (typeof request.source_url !== 'string' || !request.source_url.trim()) {
      throw new Error(`Worklist item ${index + 1} is missing source_url`)
    }
    if (!Number.isInteger(request.ttl_seconds)) {
      throw new Error(`Worklist item ${index + 1} has invalid ttl_seconds`)
    }

    return {
      audit_claim_id: item.audit_claim_id || `CLAIM-${index + 1}`,
      metadata: item,
      request: {
        claim: request.claim.trim(),
        source_url: request.source_url.trim(),
        ttl_seconds: request.ttl_seconds
      }
    }
  })
}

function requestInit(request) {
  return {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(request)
  }
}

async function preflight(endpoint, item) {
  const response = await fetch(endpoint, requestInit(item.request))
  if (response.status !== 402) {
    throw new Error(`${item.audit_claim_id}: expected HTTP 402 preflight, got HTTP ${response.status}`)
  }

  const header = response.headers.get('payment-required')
  if (!header) throw new Error(`${item.audit_claim_id}: PAYMENT-REQUIRED header missing`)

  const paymentRequired = decodePaymentRequired(header)
  if (!paymentRequired) throw new Error(`${item.audit_claim_id}: could not decode PAYMENT-REQUIRED`)

  const terms = acceptedTerms(paymentRequired)
  if (!terms) {
    throw new Error(`${item.audit_claim_id}: payment terms do not match ProofTTL testnet safety policy`)
  }

  return {
    amount_atomic_usdc: String(terms.amount),
    network: terms.network,
    scheme: terms.scheme,
    pay_to: terms.payTo
  }
}

async function paidVerify(fetchWithPayment, endpoint, item) {
  const startedAt = Date.now()
  const response = await fetchWithPayment(endpoint, requestInit(item.request))
  const raw = await response.text()
  let parsed = raw
  try { parsed = JSON.parse(raw) } catch {}

  if (!response.ok) {
    throw new Error(`${item.audit_claim_id}: paid verification returned HTTP ${response.status}: ${typeof parsed === 'string' ? parsed.slice(0, 500) : JSON.stringify(parsed).slice(0, 500)}`)
  }
  if (!parsed || typeof parsed !== 'object' || !parsed.lease_id) {
    throw new Error(`${item.audit_claim_id}: verification succeeded without a lease_id`)
  }

  return {
    audit_claim_id: item.audit_claim_id,
    issued_at_batch_ms: Date.now(),
    request_duration_ms: Date.now() - startedAt,
    payment_response_present: Boolean(response.headers.get('payment-response') || response.headers.get('x-payment-response')),
    worklist_metadata: item.metadata,
    lease: parsed
  }
}

const [, , inputArg, outputArg] = process.argv
if (!inputArg) {
  usage()
} else {
  const privateKey = process.env.PROOFTTL_TEST_PRIVATE_KEY
  if (!privateKey || !/^0x[0-9a-fA-F]{64}$/.test(privateKey)) {
    throw new Error('Missing PROOFTTL_TEST_PRIVATE_KEY. Use a burner Base Sepolia wallet only.')
  }

  const endpoint = (process.env.PROOFTTL_AUDIT_ENDPOINT || DEFAULT_ENDPOINT).replace(/\/$/, '')
  const inputPath = resolve(inputArg)
  const outputPath = resolve(outputArg || inputArg.replace(/\.json$/i, '') + '-leases.json')
  const parsed = JSON.parse(await readFile(inputPath, 'utf8'))
  const items = normalizeWorklist(parsed)
  const signer = privateKeyToAccount(privateKey)

  console.log(`ProofTTL audit batch: ${basename(inputPath)}`)
  console.log(`Payer: ${signer.address}`)
  console.log(`Endpoint: ${endpoint}`)
  console.log(`Claims: ${items.length}`)
  console.log('Running unpaid safety preflights for every claim...')

  const preflights = []
  let totalAtomic = 0n
  for (const item of items) {
    const terms = await preflight(endpoint, item)
    const amount = BigInt(terms.amount_atomic_usdc)
    totalAtomic += amount
    preflights.push({ audit_claim_id: item.audit_claim_id, ...terms })
    console.log(`PASS preflight ${item.audit_claim_id}: ${amount} atomic USDC`)
  }

  console.log(`All ${items.length} preflights passed.`)
  console.log(`Quoted total: ${totalAtomic} atomic USDC ($${(Number(totalAtomic) / 1_000_000).toFixed(6)})`)
  console.log(`Hard per-claim ceiling: ${MAX_ATOMIC_USDC_PER_CLAIM} atomic USDC`)

  if (process.env.PROOFTTL_AUDIT_CONFIRM !== CONFIRM_VALUE) {
    console.log('DRY RUN COMPLETE: no payment was authorized.')
    console.log(`To issue the leases, rerun with PROOFTTL_AUDIT_CONFIRM=${CONFIRM_VALUE}.`)
    process.exit(0)
  }

  const client = new x402Client()
  client.register(EXPECTED_NETWORK, new ExactEvmScheme(signer))
  const fetchWithPayment = wrapFetchWithPayment(fetch, client)

  console.log('Explicit confirmation detected. Issuing paid testnet Fact Leases sequentially...')
  const records = []
  for (const item of items) {
    const record = await paidVerify(fetchWithPayment, endpoint, item)
    records.push(record)
    console.log(`PASS issued ${item.audit_claim_id}: ${record.lease.lease_id}`)
  }

  const output = {
    schema_version: 'proofttl.audit-batch-result.v1',
    generated_at: new Date().toISOString(),
    source_worklist: basename(inputPath),
    payer: signer.address,
    endpoint,
    expected_network: EXPECTED_NETWORK,
    expected_pay_to: EXPECTED_PAY_TO,
    quoted_total_atomic_usdc: String(totalAtomic),
    preflights,
    claim_count: records.length,
    records,
    leases: records.map(record => ({
      ...record.lease,
      audit_claim_id: record.audit_claim_id,
      audit_metadata: record.worklist_metadata
    }))
  }

  await writeFile(outputPath, JSON.stringify(output, null, 2) + '\n', 'utf8')
  console.log(`SUCCESS: ${records.length} paid ProofTTL leases written to ${outputPath}`)
}
