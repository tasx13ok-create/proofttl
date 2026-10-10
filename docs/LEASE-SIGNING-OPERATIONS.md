# ProofTTL Lease Signing Operations

## Purpose

ProofTTL can sign lease-issuance attestations with Ed25519. The public discovery endpoint is:

`GET /.well-known/proofttl-jwks.json`

It returns a JSON Web Key Set containing public Ed25519 keys. Consumers must pin or fetch this endpoint over authenticated HTTPS according to their trust policy, select the key by `kid`, and verify the signature over the canonical `issued_attestation`. A consumer must not trust a `signature_verified` boolean supplied by an untrusted caller.

## Configuration

- `PROOFTTL_LEASE_SIGNING_PRIVATE_JWK`: secret JSON string containing an Ed25519 private JWK with `kty=OKP`, `crv=Ed25519`, `x`, and `d`.
- `PROOFTTL_LEASE_SIGNING_KEY_ID`: stable public key identifier; set this explicitly for production.
- `PROOFTTL_REQUIRE_SIGNED_LEASES=true`: fail closed on `POST /verify` when a valid signing key is not configured.

Generate a key pair with the repository's `npm run signing:key:generate` workflow in a trusted environment. Store the private JWK only as a deployment secret. Never commit it, print it in logs, place it in client-side code, or include it in issue/PR comments. Publish only the public JWK from the discovery endpoint.

When a signing key is configured, newly issued leases are signed before persistence and response. If signing fails, issuance returns a 503 and does not save or return the unsigned lease. If signing is required but no valid private key is configured, the endpoint rejects the request before fetching a source. When the requirement flag is not enabled and no key is configured, legacy unsigned issuance remains possible for compatibility; consumers that require signed leases must reject those leases.

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

The API issuance path now supports optional signing and JWKS discovery. This does **not** by itself make ProofTTL's assistant response path enforce verification, and does not make external AI providers use ProofTTL. The release gateway still needs integration at a host-controlled response/action boundary and an end-to-end test against the deployed API. Do not claim universal enforcement based on lease signing alone.
