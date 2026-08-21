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
        bind(...args) {
          this.args = args;
          return this;
        },
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

const fullAudit = {
  offer_type: 'full_audit',
  email: 'buyer@example.com',
  company_or_project: 'Example AI',
  website_url: 'https://example.com',
  claim_scope: 'Audit the claims on our pricing and API documentation pages.',
  approximate_claims: '16-25',
  why_it_matters: 'These claims are used in customer-facing sales material.',
  deadline: 'This week',
  company_site: ''
};

const stressTest = {
  ...fullAudit,
  offer_type: 'stress_test',
  approximate_claims: '3-5'
};

async function run() {
  console.log('ProofTTL audit intake tests\n');

  const db = fakeDb();
  const response = await handleAuditIntake(request(fullAudit), { MONITOR_DB: db });
  const body = await response.json();
  assert(response.status === 201, 'valid full audit intake returns HTTP 201');
  assert(body.ok === true && body.status === 'received', 'valid intake reports received');
  assert(/^ati_[a-f0-9]{32}$/.test(body.audit_intake_id), 'valid intake gets opaque audit reference');
  assert(body.offer?.type === 'full_audit' && body.offer?.price_usd === 500, 'full audit keeps the $500 flagship offer');
  assert(body.payment?.required_now === false, 'intake does not request payment before scope review');
  assert(db.rows.length === 1, 'valid intake is persisted exactly once');
  assert(db.rows[0].at(-1) === 'full_audit', 'selected offer type is persisted');

  const stressDb = fakeDb();
  const stressResponse = await handleAuditIntake(request(stressTest), { MONITOR_DB: stressDb });
  const stressBody = await stressResponse.json();
  assert(stressResponse.status === 201, 'valid stress-test intake returns HTTP 201');
  assert(stressBody.offer?.price_usd === 129, 'stress test is priced at $129');
  assert(stressBody.offer?.included_claims === '3-5', 'stress test is limited to 3-5 claims');
  assert(stressBody.offer?.upgrade?.additional_usd === 371, 'stress-test buyer can upgrade by paying only the $371 difference');

  const mismatch = await handleAuditIntake(request({ ...stressTest, approximate_claims: '16-25' }), { MONITOR_DB: fakeDb() });
  assert(mismatch.status === 400, 'claim count must match the selected offer');

  const badOffer = await handleAuditIntake(request({ ...fullAudit, offer_type: 'enterprise_magic' }), { MONITOR_DB: fakeDb() });
  assert(badOffer.status === 400, 'unknown offer type is rejected');

  const badEmail = await handleAuditIntake(request({ ...fullAudit, email: 'not-an-email' }), { MONITOR_DB: fakeDb() });
  assert(badEmail.status === 400, 'invalid email is rejected');

  const spamDb = fakeDb();
  const spam = await handleAuditIntake(request({ ...fullAudit, company_site: 'spam.example' }), { MONITOR_DB: spamDb });
  assert(spam.status === 200, 'honeypot submission receives neutral success response');
  assert(spamDb.rows.length === 0, 'honeypot submission is not persisted');

  const belowLimit = await handleAuditIntake(request(fullAudit), { MONITOR_DB: fakeDb(9) });
  assert(belowLimit.status === 201, 'nine prior requests in the window still leave one burst slot');

  const limited = await handleAuditIntake(request(fullAudit), { MONITOR_DB: fakeDb(10) });
  assert(limited.status === 429, 'the eleventh intake in a ten-request window is rate limited');
  assert(limited.headers.get('retry-after') === '600', 'rate limit includes retry-after');

  const noDb = await handleAuditIntake(request(fullAudit), {});
  assert(noDb.status === 503, 'intake fails closed when D1 storage is unavailable');

  console.log(`\nSUCCESS: ${passed} audit-intake checks passed.`);
}

run().catch((error) => {
  console.error('\nAUDIT INTAKE TEST FAILED:', error.stack || error.message);
  process.exitCode = 1;
});
