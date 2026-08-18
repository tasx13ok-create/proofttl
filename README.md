# ProofTTL

ProofTTL issues **expiring, source-backed fact leases** for machines.

Instead of treating a web fact as permanent, a client sends a claim, a source URL, and a desired TTL. ProofTTL fetches the source, verifies whether the source currently supports the claim, fingerprints the source text, stores the lease, and automatically monitors active leases for source changes. If the source changes and the original verdict can no longer be maintained before expiry, the lease is revoked.

Live API: `https://proofttl.tasx13ok.workers.dev`

Current protocol: `ProofTTL/0.3.1`

## Core principle

ProofTTL does **not** claim to determine universal truth. It answers the narrower question:

> Does this specified source currently support this exact claim?

The source, evidence, observation time, expiry, source fingerprint, verification history, and lease state travel with the result.

Verification statuses are intentionally limited to:

- `SUPPORTED`
- `CONTRADICTED`
- `UNKNOWN`

`UNKNOWN` is a valid result. ProofTTL is designed to refuse unsupported certainty.

## Current testnet state

The testnet backend now includes:

- x402 v2 payment gating on Base Sepolia
- pre-handler payment settlement so protected work does not run before settlement succeeds
- source URL / redirect SSRF controls
- bounded request and source reads
- conservative exact-match + semantic verification routing
- Workers KV lease persistence
- D1 due-time scheduling for automatic monitoring
- payer-aware verification rate limiting after payment verification
- automatic source-change monitoring and revocation
- Ed25519 issuance signatures with public-key discovery
- browser-safe API/x402 CORS
- a rate-limited voice-in/text-out assistant surface with no paid fallback
- a Better Auth security/runtime foundation with D1 schema, MFA/recovery-code support, optional OAuth providers, optional passkeys, credentialed CORS, and origin controls
- deterministic local regression suites plus live no-payment smoke verification

The guarded Windows launch path is documented in `LAUNCH-TESTNET.md` and exposed as:

```powershell
npm run launch:testnet
```

## x402 payment status

`POST /verify` is currently protected by **x402 on Base Sepolia testnet**.

Current testnet terms:

- Protocol: x402 v2
- Scheme: `exact`
- Network: `eip155:84532` (Base Sepolia)
- Asset: USDC
- Price: `$0.001` per verification request
- Receiver: `0x29949a066902bd329F74479c9AEBC448100955d8`

This is **testnet only**. Mainnet payments are not enabled yet.

### First successful paid verification

On 2026-08-17, ProofTTL completed its first end-to-end machine-paid verification on Base Sepolia:

- x402 payment gate returned payment requirements
- a separate test payer authorized the payment
- ProofTTL returned `HTTP 200`
- a payment-response header was returned
- Fact Lease issued: `ftl_2842e9c92eb24fd2a273228f1eaa4a79`
- testnet payment received by the ProofTTL receiver wallet: `0.001 USDC`
- transaction hash recorded from the wallet activity: `0x726f8f7f773ed2354eb2831d864fa0e2ca64c684f1b03ccf0c95f20b7d0537cb`

The local regression payer is intentionally testnet-only and stores its burner key in `.env.test-payer`, which is excluded from Git.

## API

### `GET /health`

Returns service status, protocol version, and whether storage, AI, and automatic monitoring are active.

### `GET /.well-known/proofttl.json`

Machine-readable ProofTTL discovery metadata, including current operational limits, payment terms, assistant capability, lease semantics, and signing capability.

### `GET /.well-known/proofttl-keys.json`

Publishes the active Ed25519 public verification key when Fact Lease signing is configured. The private key is never returned.

### `GET /.well-known/proofttl-assistant.json`

Describes the rate-limited voice-in/text-out assistant contract, model path, retention posture, and fail-closed free-capacity behavior.

### `GET /.well-known/proofttl-auth.json`

Describes the Better Auth runtime, database status, optional sign-in providers, passkeys, TOTP/recovery-code support, and auth boundary configuration.

### `/api/auth/*`

Better Auth request surface. The runtime requires D1 plus `BETTER_AUTH_SECRET`; actual customer sign-in methods depend on which optional provider/passkey configuration has been installed.

### `GET /openapi.json`

Machine-readable API description.

### `GET /pricing`

Returns current payment mode and x402 pricing metadata.

### `POST /verify`

Issues a new Fact Lease after x402 payment verification and settlement succeed.

Current request controls:

- request content type must be `application/json`
- request body is limited to 16 KiB
- unpaid challenge traffic uses a coarse outer rate-limit bucket
- verified payers are subject to a separate payer-scoped rate limit before settlement/source/AI work
- source text used by verification is bounded before normalization
- paid request shape and source safety are validated before settlement

Request:

```json
{
  "claim": "Example Domain",
  "source_url": "https://example.com",
  "ttl_seconds": 300
}
```

Example successful response:

```json
{
  "lease_id": "ftl_...",
  "protocol": "ProofTTL/0.3.1",
  "claim": "Example Domain",
  "status": "SUPPORTED",
  "issued_status": "SUPPORTED",
  "current_status": "SUPPORTED",
  "source_url": "https://example.com/",
  "evidence": "Example Domain",
  "issued_at": "2026-08-17T23:56:32.459Z",
  "expires_at": "2026-08-18T00:01:32.459Z",
  "source_fingerprint": "sha256:...",
  "confidence": 0.99,
  "verifier": "deterministic-exact-match",
  "proof_basis": "EXACT_TEXT",
  "lease_state": "ACTIVE",
  "verification_count": 1,
  "monitor_interval_seconds": 100,
  "next_check_at": "2026-08-17T23:58:12.459Z"
}
```

When signing is enabled, issuance responses also include an immutable `issued_attestation` and Ed25519 `signature` envelope.

### Lease verdict semantics

ProofTTL preserves the original issuance verdict while also exposing the latest observed verdict:

- `status` — legacy/original verdict retained for compatibility.
- `issued_status` — verdict when the Fact Lease was issued.
- `current_status` — latest observed verdict. Clients should prefer this field when deciding what the source supports now.
- `lease_state` — lifecycle state such as `ACTIVE`, `REVOKED`, or `EXPIRED`.

For example, a lease can legitimately contain `issued_status: SUPPORTED`, `current_status: CONTRADICTED`, and `lease_state: REVOKED` after automatic monitoring detects a source change.

### `GET /lease/:id`

Returns a persisted Fact Lease. An active lease becomes `EXPIRED` after its TTL elapses. Revoked leases remain `REVOKED`.

### `POST /lease/:id/reverify`

Public manual reverification is currently **disabled** and returns `403 manual_reverify_disabled`.

Active leases are reverified automatically by the scheduled monitor. The public manual endpoint is intentionally blocked so callers cannot force unmetered source fetches or AI work.

Automatic checks can record results including:

- `UNCHANGED_SOURCE` — the source fingerprint is identical.
- `SOURCE_CHANGED_STILL_CONSISTENT` — the page changed, but the original verdict is still supported.
- `REVOKED` — the source changed and the original verdict can no longer be maintained before expiry.
- `SOURCE_UNAVAILABLE` — ProofTTL could not fetch the source during the check.

Each automatic check is appended to the lease history, capped to the latest 20 checks.

### `GET /monitor/status`

Returns automatic monitoring status.

### `POST /assistant/voice`

Accepts bounded audio input and returns text output through the ProofTTL assistant path. It is rate limited, keeps no audio by default, allows only allowlisted non-destructive navigation behavior, and does not silently fall back to a paid model when free capacity is unavailable.

## Automatic monitoring and revocation

ProofTTL keeps full Fact Lease payloads in Workers KV and uses D1 as a due-time index for automatic monitoring.

A scheduled run asks D1 for leases that are due, then loads only those lease payloads from KV. A sharded reconciliation path repairs index drift without making D1 the source of truth.

The monitor avoids unnecessary verifier work when the source fingerprint is unchanged. When a source changes, ProofTTL reverifies the original claim against the new source text. If the original supported verdict can no longer be maintained while the lease is active, the lease is automatically revoked.

A controlled production test has already demonstrated this path: a source initially stating `BLUE` was changed to `RED`; ProofTTL detected the source change, determined that `RED` contradicted the original `BLUE` claim, and changed the lease state to `REVOKED` without a manual reverify request.

## Architecture

```text
claim + source URL + TTL
        |
        v
x402 payment verification
        |
        v
paid-request validation + payer quota
        |
        v
pre-handler settlement
        |
        v
source fetch + normalization
        |
        v
SHA-256 source fingerprint
        |
        +--> deterministic exact-match verifier
        |
        +--> conservative semantic verifier (Workers AI)
        |
        v
SUPPORTED / CONTRADICTED / UNKNOWN
        |
        v
Ed25519 issuance signature
        |
        v
Fact Lease in Workers KV
        |
        +--> due time indexed in D1
        |
        v
scheduled monitoring
        |
        +--> unchanged source -> keep lease
        |
        +--> changed source -> reverify
                              |
                              +--> maintain
                              +--> revoke
```

## Current stack

- Cloudflare Workers
- Cloudflare Workers AI
- Cloudflare Workers KV
- Cloudflare D1
- Cloudflare Cron Triggers
- Cloudflare Worker rate-limit bindings
- Better Auth
- Ed25519 issuance signatures
- SHA-256 source fingerprints
- x402 v2
- Base Sepolia testnet
- USDC test payments

## Safety and design choices

- ProofTTL verifies support from the caller-supplied source rather than claiming universal truth.
- Source URLs are checked for allowed schemes, credentials, ports, local hostnames, private/reserved IP literals, and DNS resolutions that point to non-public addresses.
- Redirect targets are revalidated before they are followed.
- Semantic verification may use only fetched source text, not outside knowledge.
- AI-provided evidence must occur verbatim in the normalized source or the verdict is downgraded to `UNKNOWN`.
- Source fetching has a timeout and bounded streaming text reads.
- Verification request bodies are size-limited before expensive payment/verifier work.
- Exact text matches bypass AI when possible.
- Unchanged source fingerprints bypass repeated semantic verification.
- ProofTTL prefers `UNKNOWN` to invented certainty.
- Lease history is preserved instead of silently overwriting prior observations.
- Issued and current verdicts are exposed separately so a revoked lease cannot be mistaken for a currently supported fact.
- Public manual reverification is disabled; active leases are monitored automatically.
- A verified payment is settled before protected source/AI/state work runs.
- Failed settlement does not run the protected verification handler.
- Testnet payment credentials and signing/auth secrets are never committed to the repository.
- Auth uses secure HttpOnly cookies, trusted-origin controls, credentialed CORS rules, and a required server-side session secret.
- x402 is currently testnet-only.

## Regression coverage

The repository includes automated checks for:

- SSRF/source URL validation
- request body and source-read limits
- cost accounting and idle monitor cost guards
- D1 monitor scheduling and reconciliation behavior
- lease expiry behavior
- revoked-state persistence
- unchanged-source monitoring
- automatic revocation after source changes
- verification-history capping
- Ed25519 signing, tamper detection, and public-key safety
- browser x402 CORS
- assistant guardrails/routing
- Better Auth/MFA/CORS boundaries
- Better Auth generated-schema drift
- semantic benchmark fixture validity
- hybrid model routing
- pre-settlement payment behavior
- CDP facilitator authentication
- live unpaid x402 challenge metadata

GitHub Actions runs deterministic code checks on pushes and pull requests. Live deployed-service smoke verification is kept separate so an old deployment cannot block the code change required to update it.

## Known limitations before production mainnet

- HTML extraction is still lightweight and can lose structure on complex pages.
- D1 solves due-work selection, but monitoring still uses bounded batches and periodic reconciliation rather than a dedicated queue/workflow system.
- Payer-aware request quotas exist, but account-scoped usage history, billing records, plan limits, and customer metering are not implemented yet.
- The Better Auth runtime exists, but a production customer sign-in provider and public account UI are not enabled by default.
- Fact Lease signing depends on the deployment having its signing secret installed; the guarded launcher verifies this for the testnet launch path.
- Production pricing has not been finalized from measured compute and monitoring costs.
- Mainnet settlement/facilitator configuration has not been validated end-to-end.

## Local regression tests

Run deterministic/local checks:

```powershell
npm.cmd run test:local
```

Run the live no-payment smoke test against the configured deployment:

```powershell
npm.cmd run test:smoke
```

Create a local burner payer for the optional paid test:

```powershell
npm.cmd run test:payer:create
```

Fund that address with **Base Sepolia test USDC only**, then run:

```powershell
npm.cmd run test:payment
```

The payment script performs an unpaid preflight and refuses to proceed unless the payment requirement matches the expected Base Sepolia network, exact scheme, ProofTTL receiver, and its hard test ceiling.

Never commit or share `.env.test-payer`, `.proofttl-signing-private.jwk`, or any Worker secret.

## Next milestones

1. Deploy and live-smoke-test the current D1/signing/auth hardening on the canonical testnet Worker.
2. Configure one production-grade customer sign-in path and build the public account/session UI around the existing auth runtime.
3. Add account-scoped usage accounting, billing history, plan limits, and a private operator/admin surface.
4. Measure actual verification + monitoring resource usage and turn it into a defensible production price floor.
5. Validate a production x402 facilitator/mainnet configuration with deliberately tiny limits before enabling Base mainnet.
6. Improve structured HTML/content extraction for complex sources without weakening evidence grounding.
7. Add Fact Half-Life estimation from historical source-change data.

## License

Prototype. Licensing decision pending.
