# ProofTTL

ProofTTL issues **expiring, source-backed Fact Leases** for machines.

A client supplies a claim, a public source URL, and a TTL. ProofTTL checks whether that source currently supports the claim, fingerprints the observed source text, stores the lease, and automatically monitors active leases for changes. If the source changes and the issued verdict can no longer be maintained before expiry, the lease can be revoked.

Live API: `https://proofttl.tasx13ok.workers.dev`

Protocol: `ProofTTL/0.3.1`

## What ProofTTL claims

ProofTTL does not claim universal truth. It answers a narrower and auditable question:

> Does this specified source currently support this exact claim?

Verdicts are deliberately limited to:

- `SUPPORTED`
- `CONTRADICTED`
- `UNKNOWN`

`UNKNOWN` is a valid result and is preferred over unsupported certainty.

## Current testnet platform

The backend currently contains the following testnet-grade foundations:

- x402 v2 payment gating on Base Sepolia
- pre-handler settlement before protected source/AI/state work
- SSRF and redirect-target validation
- bounded request bodies and bounded source reads
- deterministic exact-match verification plus conservative Workers AI semantic verification
- Workers KV as the Fact Lease payload store
- D1 due-time scheduling for automatic monitoring
- sharded KV-to-D1 reconciliation with a bounded fallback path
- automatic lease expiry, source-change checking, and revocation
- Ed25519 issuance signatures with public-key discovery
- payer-aware verification rate limiting
- browser-safe x402 CORS
- Better Auth runtime with D1 schema, secure sessions, TOTP/recovery codes, optional OAuth providers, and optional passkeys
- text + voice ProofTTL product assistant
- bounded six-message text-chat context
- one shared daily assistant allowance across text and voice
- atomic D1 assistant usage accounting with keyed pseudonymous subjects
- account entitlement schema for future member limits
- read-only authenticated account entitlement status
- deployment readiness diagnostics
- deterministic local regression checks
- daily no-payment / no-AI live smoke workflow

The guarded Windows launch path is:

```powershell
npm run launch:testnet
```

That command runs local tests, provisions/reuses D1 when needed, applies all migrations, preserves or creates the Better Auth secret, installs the signing key, dry-runs the Worker bundle, deploys, runs the live smoke suite, and refuses to finish unless required testnet readiness reaches 100%.

## x402 testnet payment

`POST /verify` is protected by x402 v2 on Base Sepolia.

- Scheme: `exact`
- Network: `eip155:84532`
- Asset: USDC
- Price: `$0.001` per verification
- Receiver: `0x29949a066902bd329F74479c9AEBC448100955d8`
- Production/mainnet settlement: **not enabled**

A complete paid Base Sepolia verification flow has already been proven end to end. Mainnet remains intentionally separate from that testnet validation.

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

The free assistant is intentionally **ProofTTL-product scoped**, not general-purpose chat. It can answer about ProofTTL, Fact Leases, x402, monitoring, pricing, security, the API, and product navigation.

Typed chat accepts an optional bounded context window:

- current message: max 1,200 characters
- recent history: max 6 messages
- each history message: max 600 characters
- caller history roles: `user` or `assistant` only

Deterministic navigation commands do not invoke the text model or consume AI quota.

A normal text AI request and a valid voice request share one daily allowance. The default free cap is 20 messages/day, UTC reset. Invalid voice bodies are rejected before daily quota is consumed.

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

The default future member allowance is currently configured as 200 messages/day, but **billing and self-service upgrades are not enabled**. There is no public endpoint that can grant itself membership.

### Machine-readable operations

- `GET /health`
- `GET /readiness`
- `GET /pricing`
- `GET /openapi.json`
- `GET /.well-known/proofttl.json`
- `GET /.well-known/proofttl-keys.json`

`GET /readiness` checks the actual required testnet bindings and schemas, including storage, Workers AI, verification/assistant rate limiters, D1 monitoring, auth tables, assistant usage tables, account entitlement tables, payment facilitator credentials, signing, and auth runtime state.

It intentionally reports production readiness separately and keeps it false until production-only work is actually complete.

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
- payment settlement happens before protected work
- failed x402 settlement does not execute the protected verifier
- public manual reverification is blocked to prevent unmetered source/AI work
- assistant requests are rate limited and daily-quota limited
- anonymous assistant accounting stores keyed pseudonymous identifiers rather than raw IP values
- auth secrets, payment credentials, and private signing material are not committed
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

The canonical local suite covers source/security limits, cost guards, monitor scheduling, lease state, signatures, CORS, assistant routing, contextual chat, assistant quota behavior, Better Auth boundaries/schema drift, model routing, payment-gate behavior, CDP authentication, and regression scenarios.

GitHub Actions runs `npm run test:local` plus a Wrangler dry run on pushes and pull requests. A separate scheduled workflow runs the live smoke suite daily without authorizing payment or invoking AI inference.

## Guarded testnet deployment

See `LAUNCH-TESTNET.md` for details. The short path is:

```powershell
npm run launch:testnet
```

A successful guarded launch requires:

- D1 binding present
- monitor/auth/assistant-usage/account-entitlement migrations applied
- Better Auth secret present
- signing key present
- Worker dry run successful
- deploy successful
- live x402 challenge healthy
- D1 assistant accounting active
- `/readiness` testnet score = 100%

If the launcher creates the D1 binding and modifies `wrangler.jsonc`, commit the real generated D1 binding ID afterward. Do not invent one manually.

## Intentionally unfinished production work

These are real remaining blockers rather than hidden placeholders:

- configure and validate a real customer sign-in provider/passkey production path
- cryptographically link payer wallets/transactions to customer accounts before exposing customer payment history or owned lease history
- connect a real billing provider to the existing entitlement model
- add recent-authentication flows for sensitive profile/account mutations
- measure production verification + monitoring costs and finalize a defensible price floor
- validate the production x402 facilitator and Base mainnet path with deliberately limited exposure
- improve structured extraction for complex HTML while preserving source-grounding guarantees

Until those are complete, ProofTTL should be described as a strongly hardened **testnet product**, not a finished mainnet billing platform.

## License

Prototype. Licensing decision pending.
