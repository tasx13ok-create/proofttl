# Controlled Autonomy Policy

## Objective

ProofTTL should be a verification control plane, not a replacement model and not a prompt the model can ignore. The host keeps the final release decision; the model keeps bounded control over how it reaches a useful answer.

## Control split

### The model may control
- Whether to run an additional verification pass when policy does not already require one.
- How to split a claim into smaller atomic claims, request clarification, and identify missing context.
- Which approved verifier adapter or evidence source to try first, within the host's allowlist and budget.
- Retries, alternative approved sources, regeneration, and how to explain uncertainty.
- Whether to return a qualified answer, ask the user a question, or stop when the release policy permits those choices.

### The model may not control
- Whether a policy-required verification gate runs.
- Whether a non-ALLOW result is reinterpreted as ALLOW.
- Whether an expired lease, invalid signature, missing evidence, incomplete claim inventory, verifier error, timeout, or unavailable service is silently treated as success.
- Whether the original blocked draft is released through a fallback path.
- Whether protected actions execute without the required gate and audit record.

## Policy modes

1. **Observe** — collect results and coverage metrics without blocking. Use only in controlled evaluation; never describe this as enforcement.
2. **Assist** — model chooses when to verify, but results are advisory. Appropriate only for low-risk, explicitly non-enforced workflows.
3. **Enforce** — host requires verification for policy-selected claims/actions. Only an explicit ALLOW releases the draft or authorizes the action. This is the default for consequential outputs once the host opts into enforcement.
4. **Escalate** — uncertainty, missing coverage, contradictory evidence, or infrastructure failure triggers a bounded retry, a qualified response, human review, or a block according to host policy. It never silently falls back to the unverified draft.

## Risk policy

The host, not the model, assigns the minimum verification requirement using trusted context such as action type, domain, tenant policy, and potential harm. The model may request stricter verification but cannot downgrade the host's minimum level.

- Low risk: the host may allow unverified answers if the tenant has explicitly chosen that policy.
- Medium risk: verify material factual claims; permit a clearly labeled uncertainty response when verification cannot complete.
- High/consequential risk: fail closed for the protected release/action unless policy explicitly defines a safe alternative such as human review.
- Safety-critical or regulated workflows: use domain-specific rules and qualified human oversight; ProofTTL is not a substitute for professional judgment or statutory controls.

## Bounded override and user agency

A bypass is a host-authorized policy exception, not a model self-override. It must be scoped to a request or tenant, require the appropriate permission, record who authorized it and why, and show that the result is unverified. High-risk gates should not expose a user-facing bypass unless the system owner has explicitly designed and approved one.

The user can still ask for drafts, hypotheses, brainstorming, or a list of unverified possibilities when the host's policy allows it. The UI must label these accurately and must not present them as ProofTTL-verified.

## Required protocol

1. Generate a private draft.
2. Extract atomic claims and independently assess inventory coverage.
3. Apply the host-owned risk policy.
4. For each required claim, call the configured ProofTTL verifier adapter using the real authentication/payment contract.
5. Validate response schema, evidence, lease freshness, and cryptographic signature against trusted published keys in the adapter.
6. Release only when the policy-required checks return ALLOW and coverage requirements pass.
7. On UNKNOWN, CONTRADICTED, stale/invalid lease, missing evidence, incomplete coverage, timeout, or adapter error: retry within budget, ask for clarification, qualify, escalate, or block. Do not return the blocked draft as if it passed.
8. Record the policy version, claims/check IDs, decision, timestamps, evidence references, and any authorized exception without logging secrets or unnecessary personal data.

## Important limits

An MCP server or external API cannot force an unrelated provider's private inference stack to call ProofTTL. Mandatory enforcement exists only where the model-serving provider or host application controls the release/action boundary and integrates this gate. Claim extraction is not guaranteed complete by another language model alone; use independent extraction/coverage checks, adversarial tests, and risk-specific acceptance criteria.

The verification gateway is a reusable enforcement primitive. It does not itself implement network transport, payment, signature cryptography, universal provider integration, or production deployment. Each adapter must be tested against the actual ProofTTL API/MCP contract before enforcement is advertised.
