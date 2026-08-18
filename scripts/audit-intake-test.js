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

const valid = {
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
  const response = await handleAuditIntake(request(valid), { MONITOR_DB: db });
  const body = await response.json();
  assert(response.status === 201, 'valid audit intake returns HTTP 201');
  assert(body.ok === true && body.status === 'received', 'valid intake reports received');
  assert(/^ati_[a-f0-9]{32}$/.test(body.audit_intake_id), 'valid intake gets opaque audit reference');
  assert(body.payment?.required_now === false, 'intake does not request payment before scope review');
  assert(db.rows.length === 1, 'valid intake is persisted exactly once');

  const badEmail = await handleAuditIntake(request({ ...valid, email: 'not-an-email' }), { MONITOR_DB: fakeDb() });
  assert(badEmail.status === 400, 'invalid email is rejected');

  const spamDb = fakeDb();
  const spam = await handleAuditIntake(request({ ...valid, company_site: 'spam.example' }), { MONITOR_DB: spamDb });
  assert(spam.status === 200, 'honeypot submission receives neutral success response');
  assert(spamDb.rows.length === 0, 'honeypot submission is not persisted');

  const limited = await handleAuditIntake(request(valid), { MONITOR_DB: fakeDb(3) });
  assert(limited.status === 429, 'repeated intake fingerprint is rate limited');
  assert(limited.headers.get('retry-after') === '600', 'rate limit includes retry-after');

  const noDb = await handleAuditIntake(request(valid), {});
  assert(noDb.status === 503, 'intake fails closed when D1 storage is unavailable');

  console.log(`\nSUCCESS: ${passed} audit-intake checks passed.`);
}

run().catch((error) => {
  console.error('\nAUDIT INTAKE TEST FAILED:', error.stack || error.message);
  process.exitCode = 1;
});
