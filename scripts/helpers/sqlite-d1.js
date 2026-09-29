import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
export function createSqliteD1({ migrations = ['migrations/0022_canonical_audits.sql'], filename = ':memory:' } = {}) {
  const database = new DatabaseSync(filename);
  database.exec('PRAGMA foreign_keys = ON');
  for (const file of migrations) database.exec(readFileSync(file, 'utf8'));
  return {
    database,
    prepare(sql) {
      let values = [];
      return {
        bind(...args) { values = args; return this; },
        async first(column) { const row = database.prepare(sql).get(...values) || null; return column ? row?.[column] ?? null : row; },
        async all() { return { success: true, results: database.prepare(sql).all(...values) }; },
        async run() { const result = database.prepare(sql).run(...values); return { success: true, meta: { changes: Number(result.changes), last_row_id: Number(result.lastInsertRowid) } }; }
      };
    },
    async batch(statements) {
      database.exec('BEGIN IMMEDIATE');
      try { const result = []; for (const statement of statements) result.push(await statement.run()); database.exec('COMMIT'); return result; }
      catch (error) { database.exec('ROLLBACK'); throw error; }
    },
    close() { database.close(); }
  };
}
