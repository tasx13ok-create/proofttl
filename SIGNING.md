# ProofTTL Fact Lease signing

ProofTTL can cryptographically sign the immutable issuance statement of each newly issued Fact Lease with Ed25519.

## What is signed

The signed `issued_attestation` intentionally contains issuance-time facts only:

- protocol / lease ID
- claim
- issued verdict
- source URL / final URL
- evidence and reason
- issued / expiry timestamps
- TTL
- SHA-256 source fingerprint
- confidence
- verifier
- proof basis

Mutable monitoring fields such as `lease_state`, `current_status`, `verification_count`, and later checks are not part of the issuance signature. This allows an ACTIVE lease to later become REVOKED or EXPIRED without invalidating the original signed statement about what ProofTTL issued.

## Signature envelope

When enabled, a newly issued lease includes:

```json
{
  "issued_attestation": {
    "attestation_version": "proofttl-issuance-v1"
  },
  "signature": {
    "version": "proofttl-ed25519-v1",
    "algorithm": "Ed25519",
    "key_id": "proofttl-testnet-2026-01",
    "signed_payload": "issued_attestation",
    "signed_at": "<issuance timestamp>",
    "value": "<base64url signature>"
  }
}
```

Clients can discover the public verification key at:

```text
GET /.well-known/proofttl-keys.json
```

The endpoint never returns the private key.

## Generate a signing key locally

Run:

```powershell
npm run signing:key:generate
```

The generator creates two gitignored local files:

- `.proofttl-signing-private.jwk` — secret
- `.proofttl-signing-public.jwk` — safe to inspect/share

The generator intentionally does not print the private JWK to stdout.

## Install the Worker secret

PowerShell:

```powershell
Get-Content -Raw .proofttl-signing-private.jwk | npx wrangler secret put PROOFTTL_SIGNING_PRIVATE_JWK
```

Bash:

```bash
npx wrangler secret put PROOFTTL_SIGNING_PRIVATE_JWK < .proofttl-signing-private.jwk
```

Do not commit, paste, message, or otherwise share the private JWK.

The public key ID is configured through:

```text
PROOFTTL_SIGNING_KEY_ID=proofttl-testnet-2026-01
```

## Rollout behavior

Signing is additive and rollout-safe:

- If no signing secret is configured, ProofTTL continues issuing unsigned leases and discovery reports signing as disabled.
- If a signing operation unexpectedly fails, ProofTTL logs structured telemetry and preserves the successfully settled verification instead of converting a payment into a charged 500 solely due to signature rollout.
- When a valid key is configured, new leases are signed before the normal KV persistence write and the immediate HTTP response returns the same deterministic issuance signature.
- Existing legacy leases are not retroactively claimed to have been signed at issuance.

## Verification tests

Run:

```powershell
npm run test:lease-signing
npm run test:lease-store
```

The tests cover canonicalization, Ed25519 verification, claim/fingerprint tamper detection, mutable monitor-state changes, public-key safety, and signed KV persistence.
