# Fact Audit release verification — 2026-09-09

Verification in progress. Last recorded evidence: 2026-09-09 16:39 UTC.

## Exact commercial offer

ProofTTL Fact Audit — $1,500 USD, one-time, 10–25 scoped outputs/claims. Highest-risk claims receive deep verification. Human-reviewed findings include evidence and repair recommendations. Scope is confirmed before payment. Target delivery is 3–5 business days after payment and scope confirmation. A seven-day watch covers agreed important findings. SUPPORTED, CONTRADICTED and UNKNOWN are valid outcomes; no promised positive verdict.

## Source and deployment evidence

- Reviewed backend starting point: `2ffa6d314516fff3795f5de262408bda247555c9`, branch `astra-work-2026-09-09`; main `fc8bb7b5762cacb708225ae7ca7fb88e7ca37c09`. 37 changed files against main.
- Reviewed frontend starting point: `a32bec5e801167433e0a8dea731af45b6429a5dd`, same branch name; main `6fdd6fa5064bf184f9a0798f709e772409a36af3`. 9 changed files against main.
- GitHub refs checked directly today; both starting trees were clean.
- Initial Vercel production: `ce43f9eb4000048547e3451aac836c68da0678dd`, deployment `dpl_6HELAY62mzgDuNRmQ8KNBCFrAXpK`, READY, production alias `proofttl-web.vercel.app`.
- Initial Cloudflare version: `defc2f44-88f5-41e7-aedf-bbaf57896bd4`, 100% traffic, deployed 2026-08-31 20:17:30 UTC. Its annotations contain no Git SHA, so the old backend source SHA is unverified. Do not substitute current main for this unknown value.
- Initial live `/readiness` still advertises retired offer IDs although the reviewed source advertises only `fact_audit_1500`. Backend and frontend release changes are not yet deployed.

## Buyer/payment lifecycle

Website → `/audit/` → provider authentication → preserved local `returnTo` and draft → authenticated intake → D1 request and account link → owner confirms scope at exactly $1,500 → owner creates Stripe Checkout → persisted idempotency attempt and session reuse → signed webhook or server-side Stripe retrieval validates USD 150000 cents → paid → authenticated `/audit/status/` → named human reviewer approves → owner verifies final report URL and SHA-256 → fulfillment publishes report link to the buyer and starts the exact seven-day watch window.

`?paid=1` is never payment evidence. `/mark-paid` is disabled in this release. Paid, fulfilled and checkout-bearing records cannot be casually cancelled or rescoped. Uncertain checkout attempts older than 23 hours require Stripe reconciliation before replacement. Report availability/recipient permissions and actual watch work remain explicit owner responsibilities; a stored URL or timer alone does not prove either.

## Verification completed this session

- Stripe lifecycle tests passed against actual SQLite migration SQL, including simultaneous checkout requests, retry after a lost D1 write across an hour boundary, amount/currency validation, delayed success and replay.
- Audit sales checks: 41 passed; intake checks: 25 passed.
- Authenticated local journey passed using real Better Auth signed-session validation, actual migration SQL, two accounts, concurrent intake, account linking/isolation, mocked Stripe and a locally signed webhook, approval, fulfillment and seven-day watch.
- Frontend narrow sales-intake check and TypeScript check passed.
- Full backend `npm run test:local`: PASS, including the new authenticated journey and 41 final release invariants. Full frontend `npm run check`: PASS, including production export, commercial/auth/mobile guards and 94 existing Reality Engine invariants. Wrangler deploy dry-run: PASS.
- Recent GitHub scheduled smoke run `34252226796` failed during Node setup because main had no dependency lockfile. The reviewed branch supplies it and CI now uses `npm ci`.
- Deployment verification is pending at this checkpoint.

## Remaining release gates

- Deploy the exact tested backend/frontend commits through normal GitHub integrations, then record provider evidence and bounded live smoke results.
- Real provider sign-in/returnTo and authenticated production intake have not been completed. A login tab is open for an owner-controlled account.
- Stripe connector exposes only the live ProofTTL account. No safe existing test/sandbox account has been confirmed. No live charge was made. Live webhook subscription/configuration and an actual test-mode payment remain unverified.
- Before serving the first customer, verify their report recipient can open the approved report and assign an owner for the seven-day watch.

## Intentionally deferred

Local AI clean-machine portability, prospect enrichment/outreach, mainnet settlement, membership billing, payer-account linking, isolated runner and unrelated platform work. These do not define readiness of the human-operated Fact Audit. No pricing, domain, product or business-model changes are part of this release.
