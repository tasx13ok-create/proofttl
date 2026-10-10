# ProofTTL Verification Gateway: Mandatory Release Gate

## Product goal

ProofTTL should not depend on a language model remembering to recommend or call it. The product should be an enforceable verification control in any AI application whose orchestration layer is configured to require ProofTTL before releasing factual output or performing consequential actions.

This is a gateway policy and SDK primitive, not a claim that ProofTTL can remotely force arbitrary third-party providers to invoke it. A provider-controlled or customer-controlled enforcement point is required. If the host application can ignore the gate or release the raw model response, the policy is advisory rather than enforced.

## Enforcement model

```text
User request
    |
    v
Model generates a draft (not yet visible to the user)
    |
    v
Claim inventory / atomic claim extraction
    |
    v
Coverage check: is the inventory explicitly marked complete?
    | no -> BLOCK / regenerate inventory / human review
    v yes
ProofTTL verifies each claim against its declared public source
    |
    v
Validate verdict + active lease + expiry + evidence + signed attestation
    | any missing, UNKNOWN, CONTRADICTED, expired, or unverifiable
    | -> BLOCK release; no raw-draft fallback
    v all claims supported
Release original draft with verification metadata
```

## Contract

The host application must:

1. Keep the model draft private until the gate returns `decision: "ALLOW"`.
2. Produce a complete inventory of atomic factual claims. A model-based extractor is not a mathematical guarantee of completeness; use independent coverage checks, adversarial extraction, and risk-sensitive policy. If completeness cannot be established, block or route to review.
3. Attach each claim to exact text in the draft, a public source URL, a stable ID, and a risk label.
4. Call ProofTTL using a configured adapter that handles the existing API's payment/authentication requirements. This gateway does not mint payment authorization or bypass x402.
5. Verify the Fact Lease signature against the public keys published by ProofTTL before the adapter returns `signature_verified: true`.
6. Release output only when every inventoried claim returns `SUPPORTED`, has an `ACTIVE` unexpired lease, and has evidence. `UNKNOWN`, `CONTRADICTED`, timeout, malformed response, missing evidence, unsigned/unverified lease, or upstream error all block release.
7. Never fall back to returning the original draft when verification fails. Instead, regenerate with the unsupported claim removed or qualified, ask the user for a source, or route to a human.
8. Log decision IDs, policy version, claim IDs, verdicts, lease IDs, and timing. Avoid raw prompts and sensitive claim text by default.

## Current implementation

- `src/verification-gateway.js` provides a provider-neutral, dependency-injected release gate.
- `scripts/verification-gateway-test.js` tests allow/block behavior and fail-closed cases.
- The gate defaults to requiring signed-lease validation and evidence.
- It limits work to a bounded number of claims and a bounded TTL.
- It does not call the network itself: a host-supplied `verifyClaim` adapter must use ProofTTL correctly. This keeps payment and credential policy outside the pure gate and makes unit tests deterministic.

## Integration pattern

```js
import { evaluateVerificationGate } from "./src/verification-gateway.js";

const draft = await model.generate({ prompt: userPrompt }); // do not release yet
const inventory = await extractAtomicClaimsWithCoverageAudit(draft);
const gate = await evaluateVerificationGate({
  draft,
  claims: inventory.claims,
  inventoryComplete: inventory.complete === true,
  verifyClaim: proofTtlAdapter.verifyAndValidateSignedLease,
  policy: { maxClaims: 20, ttlSeconds: 3600, requireSignedLease: true }
});

if (gate.decision !== "ALLOW") {
  // Do not return draft. Retry with unsupported claims removed, ask for sources,
  // or route to human review. Apply bounded retry/cost policy.
  return respondWithUnverifiedState(gate);
}
return releaseToUser(gate.response, { verification: gate.claims });
```

The adapter and claim extractor names above are host-application interfaces, not existing exported functions in this repository. Integrators must implement them and test the complete provider-specific path.

## Adoption strategy

- **First-party:** place this gate inside ProofTTL-owned assistant, agent, and action paths. A prompt telling the model to verify is insufficient; the release decision must be made in code outside the model.
- **SDK:** publish a small provider-neutral interface, then maintained adapters for popular AI orchestration frameworks. Each adapter must ensure no streaming tokens reach the user before verification completes; otherwise the gate can only prevent finalization, not initial disclosure.
- **Enterprise:** offer an outbound AI gateway/proxy or middleware for customer-controlled applications. Enforce policy at the app or egress boundary where the customer has authority. Define explicit behavior for tools, streaming, retries, and high-impact actions.
- **External providers:** pursue native integrations, procurement requirements, and customer deployments. No API, MCP server, system prompt, browser extension, or public web page can guarantee universal enforcement inside an unrelated provider's private inference stack.

## Acceptance criteria

- No draft is released on missing or incomplete claim inventory.
- No draft is released on `UNKNOWN`, `CONTRADICTED`, expired leases, missing evidence, invalid signatures, timeouts, or malformed verifier responses.
- No raw-draft fallback exists on a blocked decision.
- Claim/source inputs are bounded and source URLs with embedded credentials are rejected before the verifier call.
- Verification work is bounded by maximum claim count and TTL.
- No payment credentials or signatures are accepted from model-generated output.
- Tests cover supported, contradicted, unknown, expiry, signature validation, missing evidence, incomplete inventory, invalid sources, verifier failures, and claim-count limits.

## Non-goals

- Claiming that ProofTTL can force every third-party AI provider to use it without that provider's or deployer's cooperation.
- Treating model-generated claim extraction as guaranteed complete.
- Making every creative, subjective, or conversational sentence require a paid source verification.
- Treating a supported source as universal or permanent truth.


## Cryptographic trust requirement

`evaluateVerificationGate` requires `policy.trustedJwks` by default. `verifyClaim` must return the actual signed lease object (not a reduced object with a trust boolean). The gateway verifies its signature, requires exactly one trusted matching `kid`, rejects revoked IDs, and compares the signed claim and original source URL to the inventory item. Missing trusted keys, malformed signatures, unknown keys, revoked keys, and mismatched claims/sources block release.
