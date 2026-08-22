# ProofTTL v1.0.1

Release date: 2026-08-22

## Focus

v1.0.1 is a hardening and contract-consistency release. It does not change the compatible Fact Lease wire protocol (`ProofTTL/0.3.1`) or enable mainnet settlement.

## What changed

- Hardened Foundry research so candidate generation is evidence-gated and weak/no-signal runs fail closed instead of inventing support.
- Added deterministic judge fallback, evidence-based score/confidence ceilings, refreshed challenger research, accurate model-call accounting, and a repeated-stage failure watchdog.
- Restricted Foundry server-side to the two configured owner email accounts and removed Foundry from public assistant discovery metadata.
- Added owner-unmetered application entitlements for assistant daily quota, Foundry manual stepping, native file count, task count, and Studio project listing while retaining technical payload and abuse-protection limits.
- Corrected L.O.V.E. owner voice entitlement handling.
- Reconciled machine-readable assistant scope with the actual general workspace assistant runtime.
- Synchronized package, Worker health, discovery, and OpenAPI product versioning at `1.0.1`.
- Strengthened release invariants to cover Foundry privacy, owner access, the D1 failure watchdog, and deployment migration ordering.

## Unchanged trust boundaries

- Base Sepolia testnet remains the active settlement network.
- Mainnet settlement remains disabled.
- Manual public Lease reverification remains disabled.
- Sensitive actions still require explicit confirmation at the capability policy layer.
- Production secrets are not injected into Studio sandbox jobs.
- The compatible Lease protocol remains `ProofTTL/0.3.1`.
