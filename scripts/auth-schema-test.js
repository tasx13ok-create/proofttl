import { readFile } from "node:fs/promises";

const generatedPath = "generated-auth-schema.sql";
const migrationPath = "migrations/0002_auth.sql";

function normalizeSql(value) {
  return value
    .replace(/^\s*--.*$/gm, "")
    .split(";")
    .map((statement) => statement.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .sort()
    .join(";\n");
}

async function main() {
  const [generated, migration] = await Promise.all([
    readFile(generatedPath, "utf8"),
    readFile(migrationPath, "utf8")
  ]);

  const expected = normalizeSql(generated);
  const committed = normalizeSql(migration);

  if (expected !== committed) {
    throw new Error(
      `${migrationPath} does not match Better Auth 1.6.25 schema generation. Regenerate, review, and commit a new migration intentionally.`
    );
  }

  for (const required of [
    'create table "user"',
    'create table "session"',
    'create table "account"',
    'create table "verification"',
    'create table "twoFactor"',
    'create table "passkey"'
  ]) {
    if (!generated.includes(required)) {
      throw new Error(`Generated auth schema is missing expected statement: ${required}`);
    }
  }

  console.log("SUCCESS: committed ProofTTL auth migration matches generated Better Auth schema.");
}

main().catch((error) => {
  console.error("AUTH SCHEMA TEST FAILED:", error.message || error);
  process.exitCode = 1;
});
