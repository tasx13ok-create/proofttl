# ProofTTL Release Status

Current product release: **v1.0.0**

Compatible wire/Lease protocol: **ProofTTL/0.3.1**

Settlement mode: **Base Sepolia testnet**

Mainnet settlement: **disabled**

The source release is gated by the full local test suite, v1 release invariants, signed monitoring-event-chain tests, a fail-closed Cloudflare deployment workflow, and a post-deploy live smoke suite.

Frontend release: package v1.0.0 with static export/release guards and public Trust Center.

Backend release: package/OpenAPI/discovery product v1.0.0 while retaining the compatible ProofTTL/0.3.1 wire protocol. `/health` exposes the v1 product version and separately reports the underlying core version.
