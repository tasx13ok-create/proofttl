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

Machine-readable ProofTTL discovery metadata.

### `GET /openapi.json`

Machine-readable API description.

### `GET /pricing`

Returns current payment mode and x402 pricing metadata.

### `POST /verify`

Issues a new Fact Lease after x402 payment requirements are satisfied.

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

### `GET /lease/:id`

Returns a persisted Fact Lease. An active lease becomes `EXPIRED` after its TTL elapses. Revoked leases remain `REVOKED`.

### `POST /lease/:id/reverify`

Fetches the source again and checks whether the original lease can still be maintained.

Possible `check.result` values include:

- `UNCHANGED_SOURCE` — the source fingerprint is identical.
- `SOURCE_CHANGED_STILL_CONSISTENT` — the page changed, but the original verdict is still supported.
- `REVOKED` — the source changed and the original verdict can no longer be maintained before expiry.
- `EXPIRED_AND_VERDICT_CHANGED` — the lease had already expired when a changed verdict was observed.
- `SOURCE_UNAVAILABLE` — ProofTTL could not fetch the source during the check.

Each check is appended to the lease history, capped to the latest 20 checks.

### `GET /monitor/status`

Returns automatic monitoring status.

## Automatic monitoring and revocation

ProofTTL uses a Cloudflare Worker cron trigger to check active leases that are due for monitoring.

The monitor avoids unnecessary verifier work when the source fingerprint is unchanged. When a source changes, ProofTTL reverifies the original claim against the new source text. If the original supported verdict can no longer be maintained while the lease is active, the lease is automatically revoked.

A controlled production test has already demonstrated this path: a source initially stating `BLUE` was changed to `RED`; ProofTTL detected the source change, determined that `RED` contradicted the original `BLUE` claim, and changed the lease state to `REVOKED` without a manual reverify request.

## Architecture

```text
claim + source URL + TTL
        |
        v
x402 payment requirement
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
persistent Fact Lease in Workers KV
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
- Cloudflare Cron Triggers
- SHA-256 source fingerprints
- x402 v2
- Base Sepolia testnet
- USDC test payments

## Safety and design choices

- ProofTTL verifies support from the caller-supplied source rather than claiming universal truth.
- Obvious localhost/private-network URL targets are rejected.
- Semantic verification may use only fetched source text, not outside knowledge.
- AI-provided evidence must occur verbatim in the normalized source or the verdict is downgraded to `UNKNOWN`.
- Source fetching has a timeout and content-size limit.
- Exact text matches bypass AI when possible.
- Unchanged source fingerprints bypass repeated semantic verification.
- ProofTTL prefers `UNKNOWN` to invented certainty.
- Lease history is preserved instead of silently overwriting prior observations.
- x402 is currently testnet-only.
- Test payer secrets are never committed to the repository.

## Known limitations before production mainnet

- URL filtering is not yet full DNS-resolution SSRF protection.
- HTML extraction is still lightweight.
- Public manual reverification needs abuse/rate controls before broad promotion.
- Monitoring currently processes a bounded number of due leases per run.
- Revoked leases preserve the originally issued top-level status; the current changed verdict is recorded in revocation/check state. This should be made less ambiguous in a future schema revision.
- Fact Leases are not yet cryptographically signed.
- Production pricing has not been finalized from measured compute and monitoring costs.

## Local x402 regression test

Create a local burner payer:

```powershell
npm.cmd run test:payer:create
```

Fund that address with **Base Sepolia test USDC only**, then run:

```powershell
npm.cmd run test:payment
```

The payment script performs an unpaid preflight and refuses to proceed unless the payment requirement matches the expected Base Sepolia network, exact scheme, ProofTTL receiver, and its hard test ceiling.

Never commit or share `.env.test-payer`.

## Next milestones

1. Add automated regression tests for verification, revocation, and payment-gate behavior.
2. Clarify issued status vs current status in the lease schema.
3. Add rate limiting and abuse controls, especially around reverification.
4. Improve SSRF defenses with DNS resolution checks.
5. Measure real per-lease compute + monitoring cost and set production pricing.
6. Add cryptographically signed Fact Leases.
7. Validate a production x402 facilitator/mainnet configuration before enabling Base mainnet.
8. Add Fact Half-Life estimation from historical source-change data.

## License

Prototype. Licensing decision pending.
