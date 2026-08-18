import { DatabaseSync } from "node:sqlite";
import { betterAuth } from "better-auth";
import { twoFactor } from "better-auth/plugins";
import { passkey } from "@better-auth/passkey";

// Schema-only configuration for Better Auth's CLI. This intentionally uses an
// in-memory SQLite database because Cloudflare D1 is SQLite-compatible and the
// generated SQL is applied later with Wrangler D1 migrations. No real secrets,
// provider credentials, or user data are used here.
const db = new DatabaseSync(":memory:");

export const auth = betterAuth({
  appName: "ProofTTL",
  database: db,
  secret: "schema-generation-only-0123456789abcdef0123456789abcdef",
  emailAndPassword: { enabled: false },
  plugins: [
    twoFactor({
      issuer: "ProofTTL",
      allowPasswordless: true
    }),
    passkey({
      rpID: "schema.proofttl.test",
      rpName: "ProofTTL",
      origin: "https://schema.proofttl.test"
    })
  ]
});

export default auth;
