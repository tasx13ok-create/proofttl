# ProofTTL Lease Signing Operations

## Purpose

ProofTTL can sign lease-issuance attestations with Ed25519. The public discovery endpoint is:

`GET /.well-known/proofttl-keys.json` (the `/.well-known/proofttl-jwks.json` alias is also supported)

It returns a JSON Web Key Set containing public Ed25519 keys. Consumers must pin or fetch this endpoint over authenticated HTTPS according to their trust policy, select the key by `kid`, and verify the signature over the canonical `issued_attestation`. A consumer must not trust a `signature_verified` boolean supplied by an untrusted caller.

## Configuration

- `PROOFTTL_SIGNING_PRIVATE_JWK`: canonical secret name used by the repository key-generation script; secret JSON string containing an Ed25519 private JWK with `kty=OKP`, `crv=Ed25519`, `x`, and `d`.
- `PROOFTTL_LEASE_SIGNING_PRIVATE_JWK`: accepted compatibility alias for the private key secret.
- `PROOFTTL_SIGNING_KEY_ID`: canonical key ID variable already used in `wrangler.jsonc`; set it to the public key ID.
- `PROOFTTL_LEASE_SIGNING_KEY_ID`: accepted compatibility alias if the canonical variable is not set.
- `PROOFTTL_REQUIRE_SIGNED_LEASES=true`: fail closed on `POST /verify` when a valid signing key is not configured.

Set `PROOFTTL_REQUIRE_SIGNED_LEASES` to the string `"true"` in the Worker environment (for this repository, the `vars` section of `wrangler.jsonc`) **only after** the private signing secret has been provisioned and the public-key endpoint has been checked. This flag is intentionally not enabled by this PR because deployment secret presence has not been verified; enabling it prematurely makes `/verify` return 503, which is safer than issuing unsigned leases but may interrupt current issuance.

Generate a key pair with the repository's `npm run signing:key:generate` workflow in a trusted environment. Store the private JWK only as a deployment secret. Never commit it, print it in logs, place it in client-side code, or include it in issue/PR comments. Publish only the public JWK from the discovery endpoint.

The API prefers `PROOFTTL_SIGNING_PRIVATE_JWK` and accepts `PROOFTTL_LEASE_SIGNING_PRIVATE_JWK` as a compatibility alias. When a signing key is configured, newly issued leases are signed before persistence and response. If signing fails, issuance returns a 503 and does not save or return the unsigned lease. If signing is required but no valid private key is configured, the endpoint rejects the request before fetching a source. When the requirement flag is not enabled and no key is configured, legacy unsigned issuance remains possible for compatibility; consumers that require signed leases must reject those leases.

## Consumer verification requirements

1. Parse the lease's `issued_attestation` and `signature` fields.
2. Require signature algorithm/version and an allowed `kid`.
3. Obtain the corresponding public key from the trusted JWKS source; reject unknown IDs and malformed keys.
4. Canonicalize the attestation with the same canonical JSON algorithm and verify the Ed25519 signature.
5. Compare the attested claim, issued verdict, source URL/final URL, evidence, source fingerprint, timestamps, TTL, confidence, verifier, and proof basis to the lease fields.
6. Independently enforce lease expiry, active/current status, evidence requirements, source policy, and claim-to-draft binding. A valid issuance signature does not prove that a lease remains active or that a claim inventory is complete.

## Rotation and incident response

Before rotating keys, publish the new public key and update trusted consumers to accept both old and new key IDs. Then change the signing secret and key ID. Keep old public keys available for at least the longest lease TTL plus the consumer cache interval, unless a compromise requires immediate distrust. Define a documented emergency revocation process; this endpoint currently publishes the configured signing key only and does not implement a multi-key registry or revocation list.

## Current limitation

The API issuance path now requires signing in the checked-in Worker configuration, publishes a rotating keyring, and the text/voice assistant response paths fail closed unless the draft is exactly one claim supported by an active trusted signed lease. This is deliberately conservative: multi-sentence answers and ungrounded answers are blocked rather than released. It does not make external AI providers use ProofTTL or gate unrelated third-party release paths.


## Key rotation and revocation with a keyring

For overlap rotation, set the secret `PROOFTTL_SIGNING_KEYRING_JSON` to a JSON object with an `active_kid` and a `keys` array. Each key entry has a unique `kid`, and either `private_jwk` (for the active signer) or `public_jwk` (for a previous verification-only key). A `revoked: true` entry is excluded from the published public-key set and its ID is returned in `revoked_kids`.

Example shape (use real key material only in the deployment secret; do not commit it):

```json
{
  "active_kid": "proofttl-2026-10-b",
  "keys": [
    { "kid": "proofttl-2026-10-a", "public_jwk": { "kty": "OKP", "crv": "Ed25519", "x": "PUBLIC_KEY_A", "kid": "proofttl-2026-10-a" } },
    { "kid": "proofttl-2026-10-b", "private_jwk": { "kty": "OKP", "crv": "Ed25519", "x": "PUBLIC_KEY_B", "d": "PRIVATE_KEY_B" } },
    { "kid": "compromised-key", "public_jwk": { "kty": "OKP", "crv": "Ed25519", "x": "COMPROMISED_PUBLIC_KEY", "kid": "compromised-key" }, "revoked": true }
  ]
}
```

Keep the previous public key published during the overlap period so existing leases remain verifiable. Consumers must enforce the revoked list and reject leases signed by a revoked key even if a stale cache still contains that key. For emergency revocation, mark the key revoked and deploy the updated keyring immediately; the endpoint uses a short cache lifetime. A compromised active key must be replaced, not merely relabeled.
