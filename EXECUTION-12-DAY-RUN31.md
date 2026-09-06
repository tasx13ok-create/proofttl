# ProofTTL 12-Day Execution — Run 31

Date: 2026-09-05
Branch: `10xeffort-12-day-sprint`

## Shipped

- Closed a second SSRF-adjacent DNS validation gap in `src/security.js`.
- The previous source validator collected all resolver answers but truncated the unique address set to the first 32 before applying the public/private IP policy. A hostname returning more than 32 unique addresses could therefore leave later addresses completely unvalidated while the source URL still passed the safety gate.
- DNS answer handling now fails closed with `source_dns_answer_limit_exceeded` whenever the unique answer set exceeds the maximum validation budget instead of silently discarding unchecked addresses.
- Added resolver injection to the validator solely to make DNS boundary behavior deterministic and regression-testable without relying on external DNS in CI; the production default remains `dns.promises`.
- Added explicit resolver-contract failure behavior when required resolver methods are unavailable.
- Added regressions proving: exactly 32 unique public answers are fully retained and accepted, 33 unique answers fail closed, and a private address anywhere within the accepted-size answer set rejects the hostname and identifies the blocked address.

## Verification

- Code checkpoint: `2d136a13d70fff149de75bc82b4ff88ea36e1e46`.
- GitHub Actions `ProofTTL Code Checks` run `34002847435`: completed successfully.
- Core security, limits, economics, and lease primitives passed.
- Commercial/account/platform primitives passed.
- Assistant/entitlement primitives passed.
- Readiness/auth/routing/payment/research/regression checks passed.
- Worker bundle validation passed.

## Deployment / drift check

- `proofttl-web` sprint and `main` remain identical at `ce43f9eb4000048547e3451aac836c68da0678dd`; no unrelated frontend change was introduced.
- Fresh Vercel inspection shows the matching sprint preview deployment `dpl_G9gffm5Dka7uMmLyxskp2PwYYGX9` READY and the matching production deployment `dpl_6HELAY62mzgDuNRmQ8KNBCFrAXpK` READY.

## Finalization review

The substantive Run 31 diff is intentionally narrow: `src/security.js` and `scripts/security-test.js`. The change preserves the existing URL safety contract, removes silent partial DNS validation, and is reversible. CI is fully green at the code-bearing checkpoint.

## Remaining highest-value boundary

The major product boundary remains real provider integration into public `/verify`: independent discovery, bounded source retrieval, exact-source semantic evaluation, configured provider pricing, and a genuinely separate adversarial contradiction path still need to execute through the hardened evidence runtime before receipt-backed automated verification is exposed as a production capability.

A separate architectural SSRF consideration remains for any future in-process network fetcher: DNS validation and the actual socket connection must be bound to the same validated address set (or equivalent network-layer egress controls) to eliminate DNS-rebinding TOCTOU risk. The current provider abstraction should not be described as providing that guarantee until the concrete fetch transport enforces it.
