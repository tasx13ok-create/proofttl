# ProofTTL 12-Day Execution — Run 32

Date: 2026-09-05
Branch: `10xeffort-12-day-sprint`

## Shipped

- Closed an SSRF-adjacent DNS validation gap in `src/security.js` where a hostname could pass source validation when one DNS family resolved to public addresses while the other family timed out or failed resolution.
- Distinguished a normal absent record family (`ENODATA`, or an empty result from an injected deterministic resolver) from an incomplete DNS inspection caused by timeout, SERVFAIL, or another resolver failure.
- Source validation now fails closed with `source_dns_resolution_incomplete` whenever either A or AAAA validation is incomplete, rather than treating a successful public result from the other family as sufficient.
- The rejection identifies the unchecked record family and a bounded resolver error code/message to keep diagnostics actionable without weakening the policy.
- Preserved legitimate IPv4-only / IPv6-only behavior: an explicitly absent DNS family does not block a source when the present family resolves completely to validated public addresses.
- Added deterministic security regressions covering ENODATA compatibility, failed AAAA with public A, failed A with public AAAA, record-family diagnostics, and timeout diagnostics.

## Verification

- Code-bearing checkpoint: `d8bc4610ce281d4777f77de75a269590d2aea906`.
- GitHub Actions `ProofTTL Code Checks` run `34005315756`: all `local-checks` steps completed successfully.
- Core security, limits, economics, and lease primitives passed.
- Commercial, account, and platform primitives passed.
- Assistant and entitlement primitives passed.
- Readiness, auth, routing, payment, research, and regression checks passed.
- Worker bundle validation passed.

## Deployment / drift check

- `proofttl-web` sprint and `main` remain identical at `ce43f9eb4000048547e3451aac836c68da0678dd`; no unrelated web change was introduced.
- Fresh Vercel inspection shows the matching sprint preview deployment `dpl_G9gffm5Dka7uMmLyxskp2PwYYGX9` and production deployment `dpl_6HELAY62mzgDuNRmQ8KNBCFrAXpK` are both `READY` on commit `ce43f9eb4000048547e3451aac836c68da0678dd`.
- Fresh 24-hour runtime-error aggregation shows one recurring Node `DEP0169` `url.parse()` deprecation warning group on `/api/auth-proxy` and `/api/runtime-proxy`; no new application request-failure cluster was surfaced. Repository search did not identify a direct `url.parse` call in the web source, so this pass left the healthy deployment unchanged rather than making a speculative proxy rewrite.

## Finalization review

The net code-bearing diff from the previous sprint head `527a997c34e3d9cfdf06266bf46795d29dfb422d` is intentionally narrow: only `src/security.js` and `scripts/security-test.js` changed before this log. The change is reversible, preserves the existing public-address denylist and DNS-answer-limit protections, and closes the fail-open case without breaking normal single-family DNS hosts.

The remaining transport-level security boundary is unchanged: when real source retrieval is wired, the network connection must be bound to the validated address set (or equivalent controlled egress) to eliminate DNS-rebinding / validation-to-connect TOCTOU risk.

## Remaining highest-value boundary

The major product boundary remains real provider integration into public `/verify`: independent discovery, bounded source retrieval, exact-source semantic evaluation, configured provider pricing, and a genuinely separate adversarial contradiction path still need to execute through the hardened evidence runtime before receipt-backed automated verification is exposed as a production capability.