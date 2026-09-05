# ProofTTL 12-Day Execution Log — Run 12

## 2026-09-05 public contract truthfulness checkpoint

### Shipped
- Added an explicit public `/` service contract in `src/entry.js` so the public Worker no longer inherits the core-only root advertisement that presented `POST /lease/:id/reverify` like a normal callable endpoint.
- Public root metadata now marks manual reverification as disabled and identifies automatic reverification while a lease is active as the replacement behavior.
- Public root metadata now states the current verification scope truthfully: `/verify` evaluates the caller-provided source only; independent-source discovery and adversarial contradiction retrieval are not yet executed by the public verification path.
- Kept the existing explicit 403 response for public manual reverification and preserved automatic scheduled monitoring.

### Why this mattered
The public Hono wrapper intentionally blocks manual reverification, while the lower-level core root document still advertised a callable reverify endpoint. Clients hitting `/` could therefore receive a stale capability claim even though `/.well-known/proofttl.json` and OpenAPI already described manual reverify as disabled. The public wrapper now owns the public root contract and all three machine-readable surfaces agree on the externally shipped behavior.

### Verification
- Core sprint branch before this checkpoint: `5a7f4cfabb7137175d1f23b4aa854d808fec62fa`.
- Code change commit: `5bc5482c5436782ec2626ce419470da3c1b48e39`.
- GitHub Actions `ProofTTL Code Checks` run `33948786085` was triggered for that commit and was still `in_progress` during finalization; do not treat this checkpoint as CI-green until that run completes successfully.
- `proofttl-web` sprint and `main` were rechecked and remain identical at `ce43f9eb4000048547e3451aac836c68da0678dd`; no unrelated UI churn was introduced.

### Next highest-value work
1. Wire real provenance-preserving independent candidate discovery into public `/verify` through the existing evidence executor and runtime budgets.
2. Execute a genuinely separate adversarial contradiction pass when the Evidence Plan requires it.
3. Derive evidence-plan execution status and action counts from real executor receipts rather than static `NOT_EXECUTED_BY_PUBLIC_VERIFY` metadata.
4. Feed only traceable, verbatim, stance/entailment-consistent evidence into the ledger and preserve rejected/ambiguous material for auditability.
5. Re-run the full code gate and deployment/smoke checks after the first real discovery integration lands.
