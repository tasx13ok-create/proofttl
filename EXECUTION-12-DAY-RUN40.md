# ProofTTL 12-Day Sprint — Run 40

## Shipped

- Advanced the remaining DNS-rebinding boundary from passive documentation into the SOURCE_FETCH provider contract.
- Fresh prefetch URL validation now returns its concrete validated address set to the fetch adapter as an immutable `source_network_binding` containing the normalized source URL, hostname, addresses, and DNS-check flag.
- A real fetch provider can now bind its socket/transport to the exact addresses that passed ProofTTL's immediately-before-fetch validation rather than resolving the hostname again without constraints.
- When validation supplies a concrete address set, SOURCE_FETCH now fails closed unless the provider reports a `connected_address` and that address is one of the freshly validated addresses.
- Providers used in synthetic/unit contexts that intentionally return no address set remain compatible; the stricter network-attestation contract activates when concrete validation addresses exist.
- Added a focused regression proving binding metadata reaches the provider frozen/immutable, a validated address succeeds, an unvalidated/private connected address fails, and a missing connected-address attestation fails closed.
- Wired the regression into `test:evidence-orchestrator`, so it is transitively enforced by `test:local` and predeploy checks.

## Verified

- Substantive checkpoint `efbaf0606c2b2bf9f2672deb24c0e03f775525b6` passed GitHub Actions `ProofTTL Code Checks` run `34026450939`.
- Every grouped CI stage passed: core security/limits/economics/lease primitives, commercial/account/platform primitives, assistant/entitlement primitives, readiness/auth/routing/payment/research/regression, and Worker bundle validation.
- The Run 40 substantive diff from Run 39 head `a3cda3081f5c3a919015ac6ecab62c9a8fbb606b` is limited to `src/evidence-orchestrator.js`, `scripts/evidence-fetch-network-binding-test.js`, and the one-line package test-gate update before this execution-log commit.
- `proofttl-web` sprint and `main` remain identical at `ce43f9eb4000048547e3451aac836c68da0678dd`.
- Fresh Vercel inspection confirms sprint preview `dpl_G9gffm5Dka7uMmLyxskp2PwYYGX9` and production `dpl_6HELAY62mzgDuNRmQ8KNBCFrAXpK` are both `READY` on that exact web commit.

## Remains

- The transport adapter must actually use `source_network_binding.addresses` when opening the network connection; provider-reported `connected_address` is an enforceable adapter contract but is not cryptographic proof that an arbitrary third-party fetch service honored the binding.
- Wire the first real SOURCE_FETCH provider around a transport capable of explicit address binding or equivalent constrained egress, then exercise it with rebinding/integration tests.
- Wire real independent candidate discovery and separately executed adversarial contradiction providers, followed by exact-source semantic evaluation, into public `/verify` before claiming receipt-backed automated evidence execution.
- Publisher/entity normalization remains string-based beyond exact hostname aliasing; prefer a trustworthy publisher/entity identifier when a real evidence provider exposes one.
