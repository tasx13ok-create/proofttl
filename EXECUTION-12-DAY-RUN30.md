# ProofTTL 12-Day Execution — Run 30

Date: 2026-09-05
Branch: `10xeffort-12-day-sprint`

## Shipped

- Closed an SSRF classification bypass in `src/security.js` for IPv4-mapped IPv6 source literals.
- WHATWG URL canonicalization rewrites inputs such as `::ffff:127.0.0.1` to hexadecimal mapped form such as `::ffff:7f00:1`; the previous dotted-only mapped-address decoder therefore failed to apply the IPv4 private/special-use denylist to the canonicalized literal.
- `extractMappedIpv4()` now decodes both dotted and canonical hexadecimal IPv4-mapped IPv6 forms back to IPv4 before the existing IPv4 public/private classification runs.
- Preserved correct handling for genuinely public mapped addresses instead of rejecting the entire mapped address space.
- Added regressions covering mapped loopback, RFC1918 private space, link-local metadata space, and a mapped public address.

## Verification and correction loop

- The first implementation attempted to block the full `::ffff:0:0/96` space with Node `net.BlockList`.
- GitHub Actions correctly failed that checkpoint because Node's `BlockList` cross-family behavior caused ordinary public IPv4 literals to be treated as blocked when the mapped IPv6 subnet was registered.
- Reproduced that behavior locally, removed the broad mapped subnet rule, and replaced it with explicit canonical mapped-address decoding.
- Final code checkpoint: `c980b11fd64b0fe7906e06999799f9c542f7aacd`.
- GitHub Actions `ProofTTL Code Checks` run `34000222849`: completed successfully.
- Core security, limits, economics, lease primitives passed.
- Commercial/account/platform primitives passed.
- Assistant/entitlement primitives passed.
- Readiness/auth/routing/payment/research/regression checks passed.
- Worker bundle validation passed.

## Deployment / drift check

- `proofttl-web` sprint and `main` remain identical at `ce43f9eb4000048547e3451aac836c68da0678dd`; no unrelated web change was introduced.
- Fresh production-origin inspection confirms `https://proofttl-web.vercel.app/` is serving the current $1,500 Fact Audit positioning and conservative evidence/UNKNOWN language.

## Finalization review

The net diff from Run 29 is intentionally narrow: only `src/security.js` and `scripts/security-test.js` changed before this log. The final implementation is reversible, keeps the existing URL safety contract intact, and closes the mapped-address bypass without globally rejecting public IPv4-mapped IPv6 literals. The failed intermediate approach was corrected before finalization and the final code-bearing checkpoint is fully green.

## Remaining highest-value boundary

The major product boundary remains real provider integration into public `/verify`: independent discovery, bounded source retrieval, exact-source semantic evaluation, configured provider pricing, and a genuinely separate adversarial contradiction path still need to execute through the hardened evidence runtime before receipt-backed automated verification is exposed as a production capability.
