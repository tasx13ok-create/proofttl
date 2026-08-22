# ProofTTL Release Status

Current product release: **v1.0.1**

Compatible wire/Lease protocol: **ProofTTL/0.3.1**

Settlement mode: **Base Sepolia testnet**

Mainnet settlement: **disabled**

The source release is gated by the full local test suite, v1.0.1 release invariants, signed monitoring-event-chain tests, Foundry evidence/access/watchdog invariants, a fail-closed Cloudflare deployment workflow, D1 migrations, and a post-deploy live smoke suite.

Frontend release: package v1.0.1 with static export/release guards, private owner-only Foundry rendering/navigation, public Trust Center, and synchronized product metadata.

Backend release: package/OpenAPI/discovery product v1.0.1 while retaining the compatible ProofTTL/0.3.1 wire protocol. `/health` exposes the v1.0.1 product version and separately reports the underlying core version.

Foundry remains a private authenticated owner surface and is intentionally absent from public machine-readable assistant discovery.
