# ProofTTL

ProofTTL issues **expiring, source-backed fact leases** for machines.

Instead of treating a web fact as permanent, a client sends a claim, a source URL, and a desired TTL. ProofTTL fetches the source, verifies whether the source currently supports the claim, fingerprints the source text, and returns a machine-readable lease.

## Status

MVP in active development.

## API

### `GET /health`

Returns service status.

### `POST /verify`

Request:

```json
{
  "claim": "Workers KV is available on Free and Paid plans",
  "source_url": "https://developers.cloudflare.com/kv/",
  "ttl_seconds": 3600
}
```

Response shape:

```json
{
  "lease_id": "ftl_...",
  "protocol": "ProofTTL/0.1",
  "claim": "Workers KV is available on Free and Paid plans",
  "status": "SUPPORTED",
  "source_url": "https://developers.cloudflare.com/kv/",
  "final_url": "https://developers.cloudflare.com/kv/",
  "evidence": "Available on Free and Paid plans",
  "reason": "...",
  "observed_at": "2026-08-17T20:00:00.000Z",
  "expires_at": "2026-08-17T21:00:00.000Z",
  "ttl_seconds": 3600,
  "source_fingerprint": "sha256:...",
  "confidence": 0.99,
  "verifier": "...",
  "lease_state": "ACTIVE"
}
```

Statuses are intentionally limited to:

- `SUPPORTED`
- `CONTRADICTED`
- `UNKNOWN`

`UNKNOWN` is not an error. ProofTTL is designed to refuse unsupported certainty.

### `GET /lease/:id`

Returns a stored lease when persistent storage is configured. If Workers KV is not yet bound, this endpoint returns `503 persistent_storage_not_configured` while `/verify` still works.

## Core principle

ProofTTL does **not** claim to determine universal truth. It answers the narrower question:

> Does this specified source currently support this exact claim?

The source, evidence, observation time, expiry, and source fingerprint travel with the result.

## Local setup

Requirements: Node.js 20+ and a Cloudflare account.

```bash
npm install
npx wrangler login
npm run dev
```

Test locally:

```bash
curl -X POST http://localhost:8787/verify \
  -H "content-type: application/json" \
  -d '{"claim":"Workers KV is available on Free and Paid plans","source_url":"https://developers.cloudflare.com/kv/","ttl_seconds":3600}'
```

## Deploy

```bash
npm install
npx wrangler login
npm run deploy
```

Wrangler will publish the Worker to a `workers.dev` URL.

## Add persistent fact leases

The first deployment does not require storage. After the public API is working, create a KV namespace:

```bash
npx wrangler kv namespace create LEASES
```

Wrangler prints an ID. Add this block to `wrangler.jsonc`:

```json
"kv_namespaces": [
  {
    "binding": "LEASES",
    "id": "YOUR_NAMESPACE_ID"
  }
]
```

Then deploy again:

```bash
npm run deploy
```

ProofTTL will automatically persist new leases and enable `GET /lease/:id`.

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
Fact Lease + expiry
        |
        v
optional Workers KV persistence
```

## Safety choices in v0.1

- Only caller-supplied HTTP/HTTPS sources are fetched.
- Obvious localhost/private-network URLs are rejected.
- Semantic verification may use only the fetched source text, not outside knowledge.
- AI-provided evidence must occur verbatim in the normalized source or the verdict is downgraded to `UNKNOWN`.
- Source fetching has a timeout and content-size limit.
- ProofTTL prefers `UNKNOWN` to invented certainty.

## Next milestones

1. Public Worker deployment.
2. Persistent lease storage.
3. Lease revalidation and revocation when supporting evidence changes.
4. Better HTML extraction and structured-data support.
5. Signed fact leases.
6. Machine-payment endpoint and discovery metadata.
7. Fact half-life estimation from historical change rates.

## License

Prototype. Licensing decision pending.
