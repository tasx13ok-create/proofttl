# Fact Audit release verification — 2026-09-09

Release deployed; production provider authentication and a safe real Stripe test payment remain unverified. Public live checks completed 2026-09-09 16:39:56 UTC; D1 schema checked 16:41 UTC. This receipt is recorded after deployment; documentation-only receipt changes do not identify a different deployed runtime.

## Exact commercial offer

ProofTTL Fact Audit — $1,500 USD, one-time, 10–25 scoped outputs/claims. Highest-risk claims receive deep verification. Human-reviewed findings include evidence and repair recommendations. Scope is confirmed before payment. Target delivery is 3–5 business days after payment and scope confirmation. A seven-day watch covers agreed important findings. SUPPORTED, CONTRADICTED and UNKNOWN are valid outcomes; no promised positive verdict.

## Source and deployment evidence

- Reviewed backend starting point: `2ffa6d314516fff3795f5de262408bda247555c9`, branch `astra-work-2026-09-09`; main `fc8bb7b5762cacb708225ae7ca7fb88e7ca37c09`. 37 changed files against main.
- Reviewed frontend starting point: `a32bec5e801167433e0a8dea731af45b6429a5dd`, same branch name; main `6fdd6fa5064bf184f9a0798f709e772409a36af3`. 9 changed files against main.
- GitHub refs checked directly today; both starting trees were clean.
- Initial Vercel production: `ce43f9eb4000048547e3451aac836c68da0678dd`, deployment `dpl_6HELAY62mzgDuNRmQ8KNBCFrAXpK`, READY, production alias `proofttl-web.vercel.app`.
- Initial Cloudflare version: `defc2f44-88f5-41e7-aedf-bbaf57896bd4`, 100% traffic, deployed 2026-08-31 20:17:30 UTC. Its annotations contain no Git SHA, so the old backend source SHA is unverified. Do not substitute current main for this unknown value.
- Initial live `/readiness` advertised retired offer IDs although the reviewed source advertised only `fact_audit_1500`. That drift is now resolved.
- **Backend live Git SHA: `f63856709f791109f4313b1c86b90b2322e01fae`.** GitHub PR #18 merged tested source commit `c83344797fded5c1258e6ca8393e88689e2f86fb`. GitHub deployment run `34377926903` succeeded, including `npm ci`, full tests, D1 migrations, publish and live smoke. Cloudflare deployment `ce342077-8dde-47c2-8b4c-90445b70667a` explicitly records `git:f63856709f791109f4313b1c86b90b2322e01fae`; Worker version `58d853bc-ccfa-4e66-9246-48c60c3a7e84` serves 100% traffic, created 2026-09-09 16:38:32 UTC.
- **Frontend live Git SHA: `c94e16fd2a15a7c72d2d1587ae66d83413a3ce91`.** GitHub PR #15 merged tested source commit `a8be9738b6d35b0addf4769479ad2695f8eec209`. Vercel deployment `dpl_4LFG4ZqMrxnFfdd17Gv3Yd1QqA5M` is READY, target production, and its Git metadata records that exact SHA. Its aliases include `proofttl-web.vercel.app`.

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
- GitHub backend PR code checks and frontend build checks: PASS. Vercel preview of the exact frontend source commit: READY. Production backend full release and post-deploy smoke: PASS. The existing bounded live smoke suite passed 95 checks.
- Final public checks passed: homepage, `/audit/`, `/audit/sample/`, `/services/`, `/faq/`, `/trust/`, `/about/`, `/login/?returnTo=%2Faudit%2F%23audit-intake` and `/audit/status/` all HTTP 200 at `https://proofttl-web.vercel.app`.
- First-party `/api/auth/get-session`: HTTP 200, JSON null while anonymous. POSTs to first-party `/api/runtime/audit/intake` and `/api/runtime/audit/intake/status` without a session: HTTP 401. Admin checkout without authorization: HTTP 401. Unsigned Worker `/payments/stripe/webhook`: HTTP 400.
- Worker `https://proofttl.tasx13ok.workers.dev/readiness`: only `fact_audit_1500`, `scope_before_payment=true`, commercial configuration ready, Stripe mode live. `/health` is covered by the successful 95-check smoke suite. These results confirm configuration and access gates, not a completed production payment.
- Production D1 schema-only query confirmed `checkout_attempt_id`; zero rows written.

## Remaining release gates

- Real provider sign-in/returnTo and authenticated production intake have not been completed. A login tab is open for an owner-controlled account.
- Stripe connector exposes only live ProofTTL account `acct_1U61cN2KhPXeArmN`. No safe existing test/sandbox account has been confirmed. No live charge was made. The connector could not expose webhook endpoint operations, so the live endpoint subscription and delivery configuration remain unverified. In Stripe, confirm `/payments/stripe/webhook` subscribes to `checkout.session.completed`, `checkout.session.async_payment_succeeded` and `checkout.session.expired`. Complete a test-mode journey in an existing safe test environment before claiming the entire external payment path is verified; do not replace production secrets with test keys.
- Before serving the first customer, verify their report recipient can open the approved report and assign an owner for the seven-day watch.

Exact next human action: sign in through the open ProofTTL login tab with an owner-controlled account, confirm return to `/audit/#audit-intake`, and submit a clearly labelled owner test request. Then provide access to an existing Stripe test environment and inspect the live webhook subscription. Do not use a customer's account or card for verification.

## Files changed during release completion

Backend (relative to reviewed `2ffa6d3`): `.github/workflows/deploy.yml`, `.github/workflows/live-smoke.yml`, `.github/workflows/smoke.yml`, `OPERATIONS/OWNER-GUIDE.md`, `OPERATIONS/STATUS.md`, `package.json`, `migrations/0020_audit_checkout_attempt.sql`, `scripts/audit-intake-test.js`, `scripts/audit-sales-test.js`, `scripts/stripe-payments-test.js`, `scripts/audit-journey-test.js`, `scripts/audit-test-db.js`, `src/audit-intake.js`, `src/audit-sales.js`, `src/stripe-payments.js`.

Frontend (relative to reviewed `a32bec5`): `.github/workflows/frontend-checks.yml`, `components/AuditIntakeForm.tsx`, `components/AuditStatusLookup.tsx`.

Fixed: hourly checkout-key rotation after uncertain creation; concurrent intake duplication; checkout reuse without amount/currency validation; missing-session replacement risk; unverified manual paid state; cancellation erasing paid/fulfilled workflow status; scope-update race reporting success without a write; unawaited sibling checkout expiration; overlapping form submissions during session lookup; missing customer report/watch display; checkout-return wording implying external success; missing operations status; CI lockfile inconsistency and deployment SHA ambiguity. Report hosting and external OAuth/Stripe execution are explicitly separate verification gates.

## Intentionally deferred

Local AI clean-machine portability, prospect enrichment/outreach, mainnet settlement, membership billing, payer-account linking, isolated runner and unrelated platform work. These do not define readiness of the human-operated Fact Audit. No pricing, domain, product or business-model changes are part of this release.
