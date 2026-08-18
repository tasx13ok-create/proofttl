import { execFileSync } from "node:child_process";

const email = String(process.argv[2] || "").trim().toLowerCase();
const requestedLimit = Number(process.argv[3] || 5000);

if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
  console.error("Usage: npm run dev:entitle -- you@example.com [daily_limit]");
  process.exit(1);
}

if (!Number.isInteger(requestedLimit) || requestedLimit < 100 || requestedLimit > 100000) {
  console.error("daily_limit must be an integer between 100 and 100000");
  process.exit(1);
}

const escapedEmail = email.replaceAll("'", "''");

function runD1(command) {
  const args = ["wrangler", "d1", "execute", "MONITOR_DB", "--remote", "--json", "--command", command];
  const output = execFileSync(
    "npx",
    args,
    {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      shell: process.platform === "win32"
    }
  );
  return JSON.parse(output);
}

function extractRows(result) {
  if (!Array.isArray(result)) return [];
  for (const item of result) {
    if (Array.isArray(item?.results)) return item.results;
    if (Array.isArray(item?.result?.results)) return item.result.results;
  }
  return [];
}

const lookup = runD1(
  `SELECT id, email FROM "user" WHERE lower(email) = lower('${escapedEmail}') LIMIT 1;`
);
const rows = extractRows(lookup);
const user = rows[0];

if (!user?.id) {
  console.error(`No ProofTTL account exists for ${email}. Sign in to ProofTTL once, then run this command again.`);
  process.exit(2);
}

const escapedUserId = String(user.id).replaceAll("'", "''");
const now = Date.now();
const periodEnd = now + 1000 * 60 * 60 * 24 * 365;

runD1(`
INSERT INTO account_entitlement (
  user_id,
  plan,
  membership_status,
  assistant_daily_limit,
  period_end_ms,
  source,
  updated_at_ms
) VALUES (
  '${escapedUserId}',
  'member',
  'active',
  ${requestedLimit},
  ${periodEnd},
  'developer_override',
  ${now}
)
ON CONFLICT(user_id) DO UPDATE SET
  plan = excluded.plan,
  membership_status = excluded.membership_status,
  assistant_daily_limit = excluded.assistant_daily_limit,
  period_end_ms = excluded.period_end_ms,
  source = excluded.source,
  updated_at_ms = excluded.updated_at_ms;
`);

console.log(`SUCCESS: developer entitlement granted to ${email}`);
console.log(`Assistant daily limit: ${requestedLimit}`);
console.log("Plan: member (developer override)");
console.log("Billing/mainnet: unchanged");
