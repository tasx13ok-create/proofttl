import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';

// Execute actual migration SQL and conditional updates, rather than imitating SQL with strings.
export function auditTestDb(row) {
  const sqlite = new DatabaseSync(':memory:');
  const directory = new URL('../migrations/', import.meta.url);
  for (const file of readdirSync(directory).sort()) sqlite.exec(readFileSync(new URL(file, directory), 'utf8'));
  if (row) {
    row = { created_at_ms: Date.now(), request_fingerprint: 'test', approximate_claims: '10-15', claim_scope: 'Test claims', why_it_matters: 'Test risk', ...row };
    const fields = Object.keys(row);
    sqlite.prepare(`INSERT INTO audit_intakes (${fields.join(',')}) VALUES (${fields.map(() => '?').join(',')})`).run(...fields.map(f => row[f]));
  }
  return {
    sqlite,
    async exec(sql) { sqlite.exec(sql); },
    async batch(statements) { return Promise.all(statements.map(s => s.all())); },
    state: { get row() { return sqlite.prepare('SELECT * FROM audit_intakes LIMIT 1').get(); } },
    prepare(sql) {
      return {
        args: [],
        bind(...args) { this.args = args; return this; },
        async first() { return sqlite.prepare(sql).get(...this.args) || null; },
        async all() { return { results: sqlite.prepare(sql).all(...this.args), success: true, meta: { changes: 0 } }; },
        async run() { const result = sqlite.prepare(sql).run(...this.args); return { success: true, meta: { changes: Number(result.changes) } }; }
      };
    }
  };
}
