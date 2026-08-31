import { handleAuditIntake } from '../src/audit-intake.js';

let passed = 0;
function assert(condition, message) {
  if (!condition) throw new Error(message);
  passed += 1;
  console.log(`PASS ${passed}: ${message}`);
}

function fakeDb(initialCount = 0) {
  const rows = [];
  return {
    rows,
    prepare(sql) {
      return {
        args: [],
        bind(...args) { this.args = args; return this; },
        async first() {
          if (sql.includes('COUNT(*)')) return { count: initialCount };
          return null;
        },
        async run() {
          if (sql.includes('INSERT INTO audit_intakes')) rows.push(this.args);
          return { success: true };
        }
      };
    }
  };
}

function request(body) {
  return new Request('https://proofttl.test/audit/intake', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'cf-connecting-ip': '203.0.113.12',
      'user-agent': 'ProofTTL audit intake test'
    },
    body: JSON.stringify(body)
  });
}

const factAudit = {
  offer_type: 'fact_audit',
  email: 'buyer@example.com',
  company_or_project: 'Example AI',
  website_url: 'https://example.com',
  claim_scope: 'Audit the claims on our pricing and API documentation pages.',
  approximate_claims: '16-25',
  why_it_matters: 'These claims are used in customer-facing sales material.',
  deadline: 'This week',
  company_site: ''
};

async function run() {
  console.log('ProofTTL audit intake tests\n');

  const db = fakeDb();
  const response = await handleAuditIntake(request(factAudit), { MONITOR_DB: db });
  const body = await response.json();
  assert(response.status === 201, 'valid Fact Audit intake returns HTTP 201');
  assert(body.ok === true && body.status === 'received', 'valid intake reports received');
  assert(/^ati_[a-f0-9]{32}$/.test(body.audit_intake_id), 'valid intake gets opaque audit reference');
  assert(body.offer?.type === 'fact_audit' && body.offer?.price_usd === 1500, 'intake exposes the canonical $1,500 Fact Audit');
  assert(body.offer?.included_claims === '10-25', 'Fact Audit is limited to 10-25 claims');
  assert(body.offer?.monitoring_days === 7, 'Fact Audit includes seven-day monitoring');
  assert(body.offer?.human_approval_required === true, 'Fact Audit requires explicit human approval');
  assert(body.payment?.required_now === false, 'intake does not request payment before scope review');
  assert(db.rows.length === 1, 'valid intake is persisted exactly once');
  assert(db.rows[0].at(-1) === 'full_audit', 'canonical offer persists with the backwards-compatible full_audit identifier');

  const compatibility = await handleAuditIntake(request({ ...factAudit, offer_type: 'full_audit' }), { MONITOR_DB: fakeDb() });
  assert(compatibility.status === 201, 'legacy full_audit identifier remains accepted for compatible current clients');

  const retired = await handleAuditIntake(request({ ...factAudit, offer_type: 'stress_test', approximate_claims: '10-15' }), { MONITOR_DB: fakeDb() });
  assert(retired.status === 400, 'retired stress-test offer cannot create new intake');

  const tooSmall = await handleAuditIntake(request({ ...factAudit, approximate_claims: '3-5' }), { MONITOR_DB: fakeDb() });
  assert(tooSmall.status === 400, 'claim count below flagship scope is rejected');

  const tooLarge = await handleAuditIntake(request({ ...factAudit, approximate_claims: '25+' }), { MONITOR_DB: fakeDb() });
  assert(tooLarge.status === 400, 'claim count above flagship scope is rejected instead of silently overpromising');

  const badEmail = await handleAuditIntake(request({ ...factAudit, email: 'not-an-email' }), { MONITOR_DB: fakeDb() });
  assert(badEmail.status === 400, 'invalid email is rejected');

  const spamDb = fakeDb();
  const spam = await handleAuditIntake(request({ ...factAudit, company_site: 'spam.example' }), { MONITOR_DB: spamDb });
  assert(spam.status === 200 && spamDb.rows.length === 0, 'honeypot submissions receive neutral success and are not persisted');

  const belowLimit = await handleAuditIntake(request(factAudit), { MONITOR_DB: fakeDb(9) });
  assert(belowLimit.status === 201, 'nine prior requests in the window still leave one burst slot');
  const limited = await handleAuditIntake(request(factAudit), { MONITOR_DB: fakeDb(10) });
  assert(limited.status === 429 && limited.headers.get('retry-after') === '600', 'the eleventh intake is rate limited with retry-after');

  const noDb = await handleAuditIntake(request(factAudit), {});
  assert(noDb.status === 503, 'intake fails closed when D1 storage is unavailable');

  console.log(`\nSUCCESS: ${passed} audit-intake checks passed.`);
}

run().catch((error) => {
  console.error('\nAUDIT INTAKE TEST FAILED:', error.stack || error.message);
  process.exitCode = 1;
});
