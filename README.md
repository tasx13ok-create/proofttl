# ProofTTL

**ProofTTL is a source-backed claim verification and fact-checking service for factual assertions that need to survive scrutiny.**

Official website: `https://proofttl-web.vercel.app/`

Paid verification: `https://proofttl-web.vercel.app/audit/`

Verification services: `https://proofttl-web.vercel.app/services/`

Public sample audit: `https://proofttl-web.vercel.app/audit/sample/`

ProofTTL checks specific factual claims — including AI-generated and human-written claims — against public sources and returns explicit `SUPPORTED`, `CONTRADICTED`, or `UNKNOWN` verdicts with evidence and signed Fact Leases.

The name **ProofTTL** refers to this claim-verification product and website. In this product, **TTL means the time-bounded trust/freshness window attached to a source-backed verification record**. ProofTTL is not a temporal-logic proof checker, a generic cache-TTL utility, or merely a blockchain timestamping service.

## Human verification service

The current commercial wedge is a scope-first paid verification service:

- **$129 Claim Stress Test** — 3–5 high-stakes claims, target 48-hour turnaround after payment and scope confirmation, source-backed verdicts, and signed Fact Leases.
- **$500 Full Verification Audit** — 10–25 claims, target 3–5 business days after payment and scope confirmation, a verification report, signed Fact Leases, and 7 days of monitoring.
- **$371 upgrade balance** — the original $129 is credited in full toward the $500 audit.
- Scope is confirmed before payment is requested.

Good use cases include AI-output fact checking, pre-publication review, marketing claims, startup and pitch claims, research claims, website claims, product and competitor claims, public company claims, certifications, partnerships, market statistics, and selected public due-diligence claims.

ProofTTL does **not** claim universal or permanent truth. It records what examined evidence supports at a point in time, preserves `UNKNOWN` when evidence is insufficient, and does not replace legal, medical, financial, regulatory, accounting, or other professional judgment.

## Technical Fact Lease protocol

ProofTTL also contains a separate technical protocol/API that issues **expiring, source-backed Fact Leases** for machines.

A client supplies a claim, a public source URL, and a TTL. ProofTTL checks whether that source currently supports the claim, fingerprints the observed source text, stores the lease, and automatically monitors active leases for changes. If the source changes and the issued verdict can no longer be maintained before expiry, the lease can be revoked.

Live API: `https://proofttl.tasx13ok.workers.dev`

Protocol: `ProofTTL/0.3.1`

The technical x402 payment rail is testnet infrastructure and is separate from the live Stripe-backed human verification offer.

## What ProofTTL claims

ProofTTL does not claim universal truth. It answers a narrower and auditable question:

> Does this specified source currently support this exact claim?

Verdicts are deliberately limited to:

- `SUPPORTED`
- `CONTRADICTED`
- `UNKNOWN`

`UNKNOWN` is a valid result and is preferred over unsupported certainty.

## Current technical platform

The backend contains the following hardened foundations:

- x402 v2 payment gating on Base Sepolia for the technical verification endpoint
- scope-first live Stripe payment lifecycle for the human audit service
- pre-handler settlement before protected source/AI/state work on x402 routes
- SSRF and redirect-target validation
- bounded request bodies and bounded source reads
- deterministic exact-match verification plus conservative Workers AI semantic verification
- Workers KV as the Fact Lease payload store
- D1 due-time scheduling for automatic monitoring
- sharded KV-to-D1 reconciliation with a bounded fallback path
- automatic lease expiry, source-change checking, and revocation
- Ed25519 issuance signatures with public-key discovery
- payer-aware verification rate limiting
- browser-safe CORS
- Better Auth runtime with D1 schema, secure sessions, TOTP/recovery codes, OAuth provider support, and passkeys
- text + voice L.O.V.E. assistant routes
- bounded six-message text-chat context
- deterministic navigation and deterministic game-state routing where applicable
- one shared daily assistant allowance across text and voice
- atomic D1 assistant usage accounting with keyed pseudonymous subjects
- account entitlement schema for future member limits
- authenticated account workspace and audit ownership foundations
- deployment readiness diagnostics
- deterministic local regression checks
- daily no-payment / no-AI live smoke workflow

The guarded Windows testnet launch path is:

```powershell
npm run launch:testnet
```

That command runs local tests, provisions/reuses D1 when needed, applies migrations, preserves or creates required secrets, installs the signing key, dry-runs the Worker bundle, deploys, runs the live smoke suite, and refuses to finish unless required testnet readiness reaches the expected gate.

## x402 testnet payment

`POST /verify` is protected by x402 v2 on Base Sepolia.

- Scheme: `exact`
- Network: `eip155:84532`
- Asset: USDC
- Price: `$0.001` per verification
- Receiver: `0x29949a066902bd329F74479c9AEBC448100955d8`
- Production/mainnet x402 settlement: **not enabled**

A complete paid Base Sepolia verification flow has been proven end to end. Mainnet remains intentionally separate from that testnet validation.

## Main API surfaces

### Verification and leases

- `POST /verify` — x402-protected Fact Lease issuance
- `GET /lease/:id` — read a stored lease
- `POST /lease/:id/reverify` — public manual reverification is disabled and returns `403`
- `GET /monitor/status` — automatic monitoring status

Stored leases preserve both the original and current verdict:

- `status` — legacy/original verdict
- `issued_status` — explicit issuance verdict
- `current_status` — latest observed verdict
- `lease_state` — `ACTIVE`, `REVOKED`, or `EXPIRED`

When signing is configured, issuance also includes an immutable issuance attestation and Ed25519 signature envelope.

### Product assistant

- `POST /assistant/text`
- `POST /assistant/voice`
- `GET /assistant/usage`
- `GET /.well-known/proofttl-assistant.json`

L.O.V.E. is a general-purpose assistant inside the ProofTTL product shell. It can help with ordinary conversation, coding, planning, product navigation, ProofTTL questions, and grounded Fact Lease context. Live/private facts still require authoritative connected context; deterministic stateful interactions such as Tic-Tac-Toe are handled outside model memory.

Typed chat accepts an optional bounded context window:

- current message: max 1,200 characters
- recent history: max 6 messages
- each history message: max 600 characters
- caller history roles: `user` or `assistant` only

Deterministic navigation/game routes do not invoke the text model or consume AI quota.

A normal text AI request and a valid voice request share one daily allowance. The default free cap is 20 messages/day, UTC reset. Invalid voice bodies are rejected before daily quota is consumed.

### Human audit sales and account ownership

The backend also owns the live human verification intake/payment lifecycle:

- customer audit intake and status lookup
- admin scope confirmation before payment
- Stripe Checkout creation after scope approval
- Stripe webhook verification and payment-state transitions
- account-to-audit ownership links
- $129 Stress Test, $500 Full Verification Audit, and $371 credited upgrade semantics

The customer-facing audit flow is intentionally separate from the Base Sepolia x402 testnet endpoint.

### Account entitlement foundation

- `GET /account/entitlement` — credentialed, read-only account plan status
- `/api/auth/*` — Better Auth surface
- `GET /.well-known/proofttl-auth.json` — auth capability discovery

The entitlement model is deliberately fail-safe:

- anonymous user → free allowance
- authenticated user without an entitlement row → free allowance
- expired/invalid member row → free allowance
- DB entitlement lookup failure → free allowance
- only an active, unexpired `member` entitlement can receive the configured higher assistant limit

The default future member allowance is currently configured as 200 messages/day. The paid human audit service is live separately; self-service recurring membership billing is not enabled.

### Machine-readable operations

- `GET /health`
- `GET /readiness`
- `GET /pricing`
- `GET /openapi.json`
- `GET /.well-known/proofttl.json`
- `GET /.well-known/proofttl-keys.json`

`GET /readiness` checks required bindings and schemas including storage, Workers AI, rate limiters, D1 monitoring, auth tables, assistant usage, account entitlements, payment configuration, signing, and auth runtime state.

Commercial audit readiness is reported separately from technical mainnet/x402 production readiness.

## Monitoring architecture

Workers KV remains the Fact Lease source of truth. D1 is a scheduling/index layer.

```text
Fact Lease -> KV payload
          -> D1 due-time row

Cron -> D1 due IDs -> load only due KV leases -> check source
                                           |
                                           +-> unchanged: keep
                                           +-> changed: reverify
                                                        |
                                                        +-> maintain
                                                        +-> revoke
```

The KV binding used by scheduled monitoring intercepts lease listing and queries D1 for due lease IDs. A sharded reconciliation path periodically repairs D1 from KV metadata. If D1 is temporarily unavailable, a bounded compatibility fallback remains available.

## Safety properties

- source URL scheme, credentials, port, hostname, IP, DNS resolution, and redirects are checked against SSRF rules
- semantic verification is restricted to fetched source text
- model evidence must appear verbatim in normalized source text or confidence is downgraded to `UNKNOWN`
- exact matches avoid semantic AI when possible
- unchanged fingerprints avoid repeat semantic verification
- payment settlement happens before protected x402 work
- failed x402 settlement does not execute the protected verifier
- public manual reverification is blocked to prevent unmetered source/AI work
- assistant requests are rate limited and daily-quota limited
- anonymous assistant accounting stores keyed pseudonymous identifiers rather than raw IP values
- auth secrets, payment credentials, Stripe secrets, and private signing material are not committed
- audit prices and payment state are server-controlled
- account membership is server-controlled and fails closed to free access
- paid model fallback is not silently enabled

## Regression and release gates

Run the deterministic suite:

```powershell
npm run test:local
```

Run the live no-payment, no-AI-inference smoke suite:

```powershell
npm run test:smoke
```

The canonical local suite covers source/security limits, cost guards, monitoring, lease state, signatures, CORS, assistant routing/context/quota, deterministic game behavior, Better Auth boundaries/schema drift, model routing, audit/Stripe behavior, payment gates, CDP authentication, and regression scenarios.

GitHub Actions runs release checks before backend deployment and the production workflow runs live smoke checks after deploy.

## Guarded testnet deployment

See `LAUNCH-TESTNET.md` for details. The short path is:

```powershell
npm run launch:testnet
```

A successful guarded technical testnet launch requires:

- D1 binding present
- monitor/auth/assistant-usage/account-entitlement migrations applied
- Better Auth secret present
- signing key present
- Worker dry run successful
- deploy successful
- live x402 challenge healthy
- D1 assistant accounting active
- required `/readiness` testnet gates satisfied

If the launcher creates the D1 binding and modifies `wrangler.jsonc`, commit the real generated D1 binding ID afterward. Do not invent one manually.

## Current boundaries

These are intentionally kept explicit instead of hidden behind marketing:

- production Base-mainnet x402 settlement is not enabled
- the technical protocol remains testnet-oriented even though the human Stripe-backed audit service is commercial/live
- OAuth/session continuity and account-return behavior must stay covered by live regression checks before being called fully certified
- customer ownership links must remain server-enforced; a session alone must not expose another account's audit
- recurring membership billing is not enabled
- recent-authentication flows for sensitive future account mutations still need hardening
- production verification/monitoring costs should continue to be measured before widening technical payment exposure
- structured extraction for complex HTML can be improved while preserving source-grounding guarantees

## Public identity resources

- Website: `https://proofttl-web.vercel.app/`
- About: `https://proofttl-web.vercel.app/about/`
- Paid verification: `https://proofttl-web.vercel.app/audit/`
- Services: `https://proofttl-web.vercel.app/services/`
- FAQ: `https://proofttl-web.vercel.app/faq/`
- Machine definition: `https://proofttl-web.vercel.app/machine-definition/`
- AI-readable context: `https://proofttl-web.vercel.app/llms.txt`
- Frontend repository: `https://github.com/tasx13ok-create/proofttl-web`
- Backend identity file: `BRAND-IDENTITY.md`

## License

Prototype. Licensing decision pending.
