# Foundational Verification Contract

Status: Proposed architecture contract  
Scope: Model-independent verification infrastructure for consequential claims and actions  
Compatibility: Additive to the existing ProofTTL engine; this document does not authorize a rewrite or imply production certification.

## 1. Governing principle

**A system may propose an assertion; the authority granted to that assertion must not exceed what its evidence and verification method justify.**

ProofTTL is a verification and evidence layer, not an oracle. It must make the basis and limits of a conclusion inspectable, permit independent checking where feasible, and preserve an explicit unresolved state. A signature proves the integrity and origin of a record under a key; it does not prove that the record's conclusion is true.

## 2. Separate the state machines

Do not collapse these dimensions into one boolean or one overloaded status.

### 2.1 Claim finding

- `SUPPORTED`: evidence supports the precisely scoped claim under the recorded method.
- `CONTRADICTED`: evidence conflicts with the precisely scoped claim under the recorded method.
- `UNKNOWN`: evidence is insufficient to support or contradict it.
- `CONFLICTED`: credible evidence supports materially incompatible conclusions and the conflict remains unresolved.
- `NOT_APPLICABLE`: the input is not a testable factual claim under the current contract, with a reason recorded.

These labels are findings relative to evidence, scope, and method—not declarations of absolute truth. A stale result is not a claim finding.

### 2.2 Execution status

Track processing separately: `PENDING`, `RUNNING`, `COMPLETED`, `PARTIAL`, `FAILED`, `TIMED_OUT`, `CANCELLED`. A tool outage, parse error, missing credential, or failed source must never be silently converted into `UNKNOWN` or `SUPPORTED`. If evidence coverage is incomplete, record that limitation explicitly.

### 2.3 Freshness and validity

Track freshness separately: `CURRENT`, `STALE`, `EXPIRED`, `REVOKED`. Define expiry policy per claim class and source volatility. A historical signed result remains a record of what was issued at that time; it must not be presented as proof that a time-sensitive claim remains true now.

### 2.4 Action decision

The consuming application owns an explicit risk policy that maps findings, execution state, freshness, claim criticality, and required evidence to `ALLOW`, `ALLOW_WITH_QUALIFICATION`, `REQUIRE_MORE_EVIDENCE`, `REQUIRE_HUMAN_REVIEW`, or `BLOCK`. ProofTTL can recommend a disposition, but the contract must make clear which component is authoritative for enforcement. High-risk actions fail closed when required checks are missing or inconclusive.

## 3. Canonical verification record

Every completed evaluation should produce a versioned record containing, where applicable:

1. Stable evaluation ID and schema version.
2. Original claim and normalized atomic claims, retaining source text and context.
3. Scope, assumptions, relevant time interval, jurisdiction or environment, and material definitions.
4. Claim finding, execution status, freshness state, and action recommendation as separate fields.
5. Evidence references: source identity, canonical URL or content identifier, retrieval time, relevant excerpt or locator, content hash when feasible, and access limitations.
6. Supporting and contradicting evidence, including evidence that was sought but unavailable.
7. Method and verifier version, tool/provider versions when material, transformations performed, and reproducibility instructions where feasible.
8. Coverage and limitations: which subclaims were evaluated, which were not, known blind spots, and why the result is bounded.
9. Independent challenge or corroboration details, clearly distinguishing genuinely independent sources or methods from repeated model output.
10. Creation time, validity/expiry policy, supersession or revocation links, and audit history.
11. Signature metadata and key identifier where signing is used.
12. Human review identity/role and decision where required, without leaking unnecessary personal data.

Do not claim reproducibility if source content is inaccessible, mutable, or not retained. Record those limits instead.

## 4. Verification behavior

- Decompose compound outputs into atomic, testable claims while preserving the original statement and context.
- Use exact matching only where it is semantically safe; do not treat string similarity as proof.
- Preserve qualifiers, negation, units, dates, populations, jurisdiction, and causal scope.
- Seek disconfirming evidence for consequential claims; do not search only for confirmation.
- Prefer primary/authoritative evidence when appropriate, but evaluate source relevance, independence, date, and integrity rather than assuming a source is infallible.
- Do not count agreement among models sharing the same evidence or failure mode as independent confirmation.
- Return `UNKNOWN` or `CONFLICTED` when the evidence does not justify a stronger finding.
- Treat generated explanations as explanations, not evidence, unless their factual premises are independently supported.
- Record failed checks and missing sources. Never silently omit them from coverage reporting.
- Re-evaluate time-sensitive findings when the evidence or validity window changes.

## 5. Consequence-scaled policy

Verification depth must scale with expected harm, reversibility, uncertainty, and cost of failure.

- Low consequence: lightweight checks and clear uncertainty labels may be sufficient.
- Material consequence: source-backed checks, counterevidence search, and a recorded rationale.
- High consequence or hard-to-reverse action: independent challenge appropriate to the domain, stronger evidence requirements, policy-controlled enforcement, and human authorization where required.
- Critical safety/security/financial actions: no automatic permission solely because a model or verifier says `SUPPORTED`; require domain-specific controls, operational safeguards, and explicit authority.

A universal protocol does not imply a universal verification method. Medical, legal, security, financial, scientific, and software claims need domain-appropriate tests and authority boundaries.

## 6. Fact Lease and signed-record rules

A Fact Lease is a bounded, time-scoped statement about a particular claim and evidence set—not a permanent guarantee of truth.

A lease must bind to the claim/context, evidence or evidence manifest, verifier/method version, finding, issuance time, expiry policy, and signing key identity. Consumers must be able to verify signature integrity, identify the issuer, check expiry/revocation/supersession where supported, and distinguish cryptographic validity from evidentiary quality.

Do not issue a stronger lease than the underlying verification supports. High/critical claims must not become lease-eligible merely because a payment succeeded, a signature can be generated, or an automated model returned a confident answer. Payment authorizes a product workflow; it is not evidence of correctness.

## 7. Security and multi-tenant boundaries

- Bind each request, payment/entitlement, evidence record, lease, and retrieval operation to the authenticated tenant and authorized principal.
- Enforce authorization server-side on every read and write; do not rely on UI filtering or untrusted tenant IDs.
- Make payment fulfillment idempotent and verify provider signatures, amount, currency/network, recipient, asset, chain, confirmation policy, and transaction identity as appropriate.
- Prevent duplicate fulfillment, replay, cross-tenant access, forged callbacks, and lease issuance before verified payment where payment is required.
- Keep secrets out of logs and proof payloads. Minimize retained personal and confidential source data.
- Define key rotation, revocation, incident response, rate limits, abuse controls, and retention/deletion policy before production claims.
- Separate testnet/sandbox evidence from production-mode evidence in status, UI, logs, and documentation.

## 8. Required acceptance tests

The contract is not implementation-complete until tests demonstrate:

1. Supported, contradicted, unknown, conflicted, and non-applicable examples with expected outcomes.
2. Negation, qualifiers, temporal scope, units, compound claims, and ambiguous inputs.
3. Missing, stale, contradictory, inaccessible, and mutated evidence.
4. A tool/provider outage produces an explicit execution failure or partial result, never a fabricated finding.
5. A separate client can verify a signed record and detect altered payloads, unknown keys, expired records, and revoked/superseded records where implemented.
6. Repeated requests and duplicate webhooks do not create duplicate charges, entitlements, leases, or inconsistent state.
7. Cross-tenant and unauthenticated access is denied at the backend.
8. High-risk policy blocks or escalates when required independent checks are missing.
9. A real external MCP/client workflow completes from request through result verification and retrieval.
10. Regression fixtures include false-positive attacks and positive controls; report both, with fixture counts and limits, without treating fixture performance as a population reliability estimate.
11. Payment, audit, and lease lifecycles are tested end-to-end in sandbox/testnet and separately validated in production configuration before launch.
12. Operational telemetry exposes failure rates, latency, stale evidence, unresolved claims, provider outages, and lease revocations without logging sensitive content unnecessarily.

## 9. Measurement

Track at minimum:

- False-supported rate on a documented, adversarially designed evaluation set.
- False-contradicted rate and positive-control retention.
- Correct abstention rate for unresolved or insufficient-evidence cases.
- Evidence coverage and provenance completeness.
- Performance by claim type, risk tier, source type, and verifier version.
- Freshness/revocation handling and time to detect changed evidence.
- End-to-end task success, latency, cost, and human escalation rate.
- Independent-client interoperability and reproducibility.
- Customer outcomes: consequential errors caught, time saved, and willingness to pay.

Publish dataset composition, limitations, and version changes. Synthetic fixtures are useful for regression but do not establish real-world reliability on their own.

## 10. Integration strategy

Keep one canonical engine and contract. Expose it through adapters (MCP, API, SDK, webhooks, and future protocols) without duplicating truth logic in each adapter. Adapters translate transport and identity; they must not silently change claim semantics or findings.

Use backward-compatible, versioned schemas and contract tests. Treat provider-host compatibility as unverified until exercised in each supported host. A local or isolated preview passing does not prove native host, OAuth/account linking, or production deployment readiness.

## 11. Release gates

Do not describe the system as production-ready until the relevant gates are evidenced:

- Canonical contract and threat model reviewed.
- Automated regression, adversarial, positive-control, and security tests pass on the release commit.
- Independent external client verifies signatures and completes a real host workflow.
- Authentication, OAuth where applicable, tenant isolation, quotas, and abuse controls are verified.
- Sandbox/testnet payment behavior is distinguished from live-mode acceptance; production webhooks and fulfillment are tested safely.
- Monitoring, incident response, key management, revocation, backup/recovery, and rollback are operational.
- Domain-specific limitations and unresolved cases are visible to the user.
- At least one external user validates the intended workflow; commercial claims are based on actual customer outcomes.

A passing test suite is evidence about the tested cases, not a proof of universal correctness. Do not claim that ProofTTL eliminates hallucinations or guarantees truth.

## 12. Implementation order

1. Map the existing code to this contract; identify gaps before changing working components.
2. Add or tighten schema and contract tests first.
3. Verify signed-record retrieval and failure/uncertainty behavior with an independent client.
4. Verify payment-to-entitlement-to-delivery end-to-end without live financial risk.
5. Complete provider-host/OAuth compatibility tests for each claimed integration.
6. Run a narrow external pilot with measurable acceptance criteria.
7. Expand domains and automation only when evidence supports the next level of assurance.

## Decision rule

**Preserve working systems. Make the smallest change that closes a demonstrated gap. Do not merge, deploy, or market a capability solely because its design is persuasive.**

The product promise is evidence-backed, bounded verification—not infallibility.
