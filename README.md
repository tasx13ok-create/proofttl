# ProofTTL

ProofTTL issues **expiring, source-backed fact leases** for machines.

Instead of treating a web fact as permanent, a client sends a claim, a source URL, and a desired TTL. ProofTTL fetches the source, verifies whether the source currently supports the claim, fingerprints the source text, stores the lease, and can later reverify it. If the source changes and the original verdict can no longer be maintained before the lease expires, the lease is revoked.

Live API: `https://proofttl.tasx13ok.workers.dev`

## Core principle

ProofTTL does **not** claim to determine universal truth. It answers the narrower question:

> Does this specified source currently support this exact claim?

The source, evidence, observation time, expiry, source fingerprint, and verification history travel with the result.

## API

### `GET /health`

Returns service status, version, and whether storage/AI bindings are live.

### `POST /verify`

Request:

```json
{
  "claim": "Example Domain",
  "source_url": "https://example.com",
  "ttl_seconds": 3600
}
```

Response shape:

```json
{
  "lease_id": "ftl_...",
  "protocol": "ProofTTL/0.2",
  "claim": "Example Domain",
  "status": "SUPPORTED",
  "source_url": "https://example.com",
  "evidence": "Example Domain",
  "issued_at": "2026-08-17T21:00:00.000Z",
  "expires_at": "2026-08-17T22:00:00.000Z",
  "source_fingerprint": "sha256:...",
  "confidence": 0.99,
  "lease_state": "ACTIVE",
  "verification_count": 1
}
```

Verification statuses are intentionally limited to:

- `SUPPORTED`
- `CONTRADICTED`
- `UNKNOWN`

`UNKNOWN` is a valid result. ProofTTL is designed to refuse unsupported certainty.

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

## Quick test in PowerShell

Create a lease:

```powershell
$body = @{
  claim = "Example Domain"
  source_url = "https://example.com"
  ttl_seconds = 300
} | ConvertTo-Json

$result = Invoke-RestMethod `
  -Uri "https://proofttl.tasx13ok.workers.dev/verify" `
  -Method POST `
  -ContentType "application/json" `
  -Body $body

$result | ConvertTo-Json -Depth 10
```

Fetch it:

```powershell
Invoke-RestMethod "https://proofttl.tasx13ok.workers.dev/lease/$($result.lease_id)" | ConvertTo-Json -Depth 10
```

Reverify it:

```powershell
Invoke-RestMethod `
  -Uri "https://proofttl.tasx13ok.workers.dev/lease/$($result.lease_id)/reverify" `
  -Method POST | ConvertTo-Json -Depth 10
```

## Architecture

```text
claim + source URL + TTL
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
reverification -> unchanged / still consistent / revoked
```

## Safety choices in v0.2

- Only caller-supplied HTTP/HTTPS sources are fetched.
- Obvious localhost/private-network URLs are rejected.
- Semantic verification may use only the fetched source text, not outside knowledge.
- AI-provided evidence must occur verbatim in the normalized source or the verdict is downgraded to `UNKNOWN`.
- Source fetching has a timeout and content-size limit.
- ProofTTL prefers `UNKNOWN` to invented certainty.
- Original lease verdicts remain preserved; reverification adds state/history instead of silently rewriting the past.

## Current stack

- Cloudflare Workers
- Cloudflare Workers AI
- Cloudflare Workers KV
- SHA-256 source fingerprints

## Next milestones

1. Automated monitoring for leases that opt into it.
2. Better HTML extraction and structured-data support.
3. Cryptographically signed Fact Leases.
4. Public machine-readable protocol/schema.
5. Machine-payment endpoint and discovery metadata.
6. Fact half-life estimation from historical change rates.

## License

Prototype. Licensing decision pending.
