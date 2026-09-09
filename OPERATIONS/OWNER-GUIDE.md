# ProofTTL owner guide

Start here tomorrow. This is a service business supported by software. Sell one carefully scoped audit before adding infrastructure.

## What you own

Keep these two folders next to each other:

```
proofttl-web/    website: Next.js static export + Vercel API proxies
proofttl/        Cloudflare Worker API, D1/KV, auth, audit lifecycle, Stripe
  local-ai/     local model interface, SQLite memory, leads, bounded task queue
  sales/        researched leads, outreach templates, playbook, sample finding
  OPERATIONS/   this guide, verification status, prioritized remaining work
```

ProofTTL checks exact factual claims against evidence observed at a stated time. SUPPORTED, CONTRADICTED and UNKNOWN are all legitimate results. A signed Fact Lease records an observation and freshness window; a signature does not prove universal truth. The paid human service is separate from the Base Sepolia/x402 experiment.

## The active offer and money path

One $1,500 USD Fact Audit: 10–25 real outputs or claims, ranking by consequence, deep verification of the highest-risk claims, evidence and repair recommendations, human approval before publication, and seven days of monitoring of the important findings plus a final reread. Confirm which claims receive deep verification and which are only triaged. Target delivery is 3–5 business days after scope and payment.

Buyer: website → sample → `/audit/` → sign in → submit scope → `/audit/status/` → owner confirms scope → owner creates Stripe Checkout → buyer pays → verified webhook marks paid → owner reviews findings → approve → deliver → monitor and reread.

The code in `src/audit-intake.js`, `src/audit-sales.js`, and `src/stripe-payments.js` enforces the price. Stripe creates inline `price_data` for **150000 USD cents**, not a client-supplied price or a saved Stripe Price ID. No pilot discount or upgrade is active. Historical release notes and old Git commits are not price authority.

Never treat `?paid=1` in a browser URL as proof of payment. Check stored payment status and Stripe. `/mark-paid` is disabled. To recover a paid session, repeat the checkout endpoint (it retrieves and validates the stored Stripe session) or replay the verified webhook. An uncertain checkout attempt older than 23 hours fails closed and requires manual Stripe reconciliation before any replacement is issued.

Before fulfillment, open the final HTTPS report URL as the intended recipient and confirm it downloads the approved report; compute its SHA-256 from those exact bytes. The API validates the URL format and digest format, not remote availability or recipient permissions. Seven-day watch timestamps record the agreed service window; the owner must actually review the agreed findings during that window and communicate material changes.

## Prerequisites and installation

Use the existing Node.js 24 and Git installations. On another PC, install Node LTS from https://nodejs.org/ and Git from https://git-scm.com/. GitHub, Vercel and Cloudflare logins belong to you. No paid model key is required.

```powershell
git clone https://github.com/tasx13ok-create/proofttl.git
git clone https://github.com/tasx13ok-create/proofttl-web.git
Set-Location proofttl
npm ci --no-audit --no-fund
Set-Location ..\proofttl-web
npm ci --no-audit --no-fund
Copy-Item .env.example .env.local
npm run dev
```

Read `DEPLOYMENT.md` in the web repo: ordinary `next dev` serves the UI but does **not** run the Vercel `api/*.js` proxies. For local integrated auth use a separately configured test backend and the Vercel local runtime; do not point a synthetic payment test at production. Local public-page viewing and type/build checks need no credentials.

Backend, in a second terminal:

```powershell
Set-Location ..\proofttl
Copy-Item .dev.vars.example .dev.vars
npx wrangler d1 migrations apply MONITOR_DB --local
npm run dev
```

This is local emulation, not a production deployment. Keep real production signing keys and Stripe secrets out of local experiments. Wrangler may ask for Cloudflare access for nonlocal bindings. If it does, stop and decide whether that service is needed. Local regression tests use mocks and need no cloud credentials.

## Validate changes

Frontend:

```powershell
npm run check
```

This typechecks, builds static routes, then runs discovery, funnel, auth, navigation, mobile-source and existing release invariants. `out/` is generated and excluded from typechecking.

Backend:

```powershell
npm run test:local
npx wrangler deploy --dry-run
```

The backend is JavaScript and has no separate TypeScript script. Worker bundling and regression tests are its checks. The live smoke suite (`npm run test:smoke`) performs bounded probes without payment or AI inference; it is not proof that an actual customer login or charge succeeded.

Local workstation:

```powershell
Set-Location local-ai
npm ci --no-audit --no-fund
npm test
.\Start-LocalAI.ps1
```

See `local-ai/README.md` for offline operation, commands and recovery. Data is private local SQLite in `local-ai/data/`, intentionally ignored by Git. Back it up separately while the agent is stopped; include the whole directory or use SQLite backup, not just a live database file missing its WAL.

## Audit operations

Use the existing admin endpoints with `PROOFTTL_ADMIN_TOKEN`. Retrieve it from your password/secret manager. Do not paste it into chat, a repository file or a command recorded in shell history. This PowerShell pattern prompts without putting the token literal in history:

```powershell
$auditApi = 'https://proofttl.tasx13ok.workers.dev'
$auditSecure = Read-Host 'ProofTTL admin token' -AsSecureString
$auditToken = [System.Net.NetworkCredential]::new('', $auditSecure).Password
$auditHeaders = @{ Authorization = 'Bearer ' + $auditToken }
Invoke-RestMethod -Uri "$auditApi/admin/audit/intakes?status=received&limit=25" -Headers $auditHeaders
```

This response contains customer data. Keep it private. Review daily; the repository does not demonstrate a reliable owner email notification on intake.

After agreeing the exact scope with the customer, replace the request ID and summary below:

```powershell
$auditId = 'ati_REPLACE_WITH_32_HEX_CHARACTERS'
$scopeBody = @{scope_summary='Exact accepted claims, exclusions, deep-check set, and deliverables'; price_usd=1500; scope_turnaround='3–5 business days after payment'} | ConvertTo-Json
Invoke-RestMethod -Method Post -Uri "$auditApi/admin/audit/intakes/$auditId/scope" -Headers $auditHeaders -ContentType 'application/json' -Body $scopeBody
Invoke-RestMethod -Method Post -Uri "$auditApi/admin/audit/intakes/$auditId/checkout" -Headers $auditHeaders
```

Use the returned payment URL only for this customer and intake. This command creates a real checkout invitation, not a charge. Do not run it for testing against live keys. Existing open sessions are reused. Paid/fulfilled requests must never be rescoped; retain their history and handle changed scope deliberately. More-than-25 intake is not automatically eligible: confirm a smaller scope/new intake before checkout.

After payment, perform the evidence work using the template in `sales/AUDIT-DELIVERY-TEMPLATE.md`. Human-review every finding. Do not publish customer material publicly without authorization. Deliver using a customer-approved HTTPS location with access appropriate to the data; the current backend stores a report URL/hash and does not itself provide private report-file hosting.

```powershell
$reviewBody = @{reviewer='YOUR NAME'} | ConvertTo-Json
Invoke-RestMethod -Method Post -Uri "$auditApi/admin/audit/intakes/$auditId/approve" -Headers $auditHeaders -ContentType 'application/json' -Body $reviewBody
$reportHash = (Get-FileHash -LiteralPath '.\customer-report.pdf' -Algorithm SHA256).Hash.ToLower()
$deliveryBody = @{report_url='https://REPLACE-WITH-APPROVED-REPORT-URL'; report_sha256=$reportHash} | ConvertTo-Json
Invoke-RestMethod -Method Post -Uri "$auditApi/admin/audit/intakes/$auditId/fulfill" -Headers $auditHeaders -ContentType 'application/json' -Body $deliveryBody
Remove-Variable auditToken,auditSecure,auditHeaders
```

`fulfill` records a seven-day window. A clock saying “active” does not prove evidence was reread. Maintain a daily evidence-check log and a day-seven final reread. Fact Lease monitoring is separate and only covers claims actually issued as monitored leases. Never claim automatic commercial fulfillment or coverage you have not arranged.

## Stripe and deployment

Backend production secrets include Stripe secret/webhook secret, admin token, Better Auth secret, signing private JWK, OAuth credentials and existing CDP experiment credentials. `.dev.vars.example` is guidance, not real secrets. Use Cloudflare's secret manager or `wrangler secret put NAME`, which prompts for the value.

Stripe webhook destination: `/payments/stripe/webhook` on the Worker. Subscribe to `checkout.session.completed`, `checkout.session.async_payment_succeeded`, and `checkout.session.expired`. Verify signature, amount, currency, intake metadata and replay behavior. Refunds/disputes require manual reconciliation; there is no full refund-management system here.

The backend `main` push workflow tests, applies D1 migrations, deploys and smoke-tests using existing GitHub secrets. The frontend deploys through the existing Vercel Git integration. Push a review branch first; review CI and the diff before merging. Do not force-push. Do not redeploy from an old snapshot if main has advanced. Keep the current provider accounts and URLs; no new domain is needed.

```powershell
git status --short
git diff --stat
git fetch origin
git log --oneline -5
git push -u origin HEAD
```

The last command publishes your current branch. See `STATUS.md` for whether this session actually pushed/deployed. A local commit alone does not update the live site.

## Troubleshooting and recovery

* Intake login fails: check `/api/auth/get-session`, auth discovery, Vercel proxy logs and OAuth callback origins. Do not remove authentication to make the error disappear.
* Scope text rejected: maximum 12,000 characters, explicit errors for oversized fields. Keep an export of the claims. Do not repeatedly submit until checking whether a request already exists.
* Payment pending: inspect Stripe event delivery and signature secret; use original checkout recovery before creating another session. Never infer payment from a redirect.
* Build fails: read the first error. `npm ci` restores the committed dependency tree. Do not delete source files to satisfy a build.
* Broken change: preserve `git diff` and local untracked data first; use `git revert COMMIT` on your branch after review. Avoid `reset --hard` and force pushes.
* Local AI unavailable: text search, lead tracking, drafts and checks still work through `node local-ai/agent.mjs /status`. Start the portable model separately. The model is small and is not a substitute for evidence or human judgment.
* Secrets leaked: revoke/rotate at the provider immediately; deleting a line from Git does not revoke a token or remove history.

