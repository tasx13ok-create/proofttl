# ProofTTL AI Host Integration Contract

Status: design target for the software-first branch. This document is intentionally stricter than the current runtime and does not claim the MCP server or host UIs are implemented yet.

## Product rule

ProofTTL must be useful inside an AI conversation without requiring the user to leave the host.

The same verification engine should support ChatGPT, Codex, Grok, Claude-compatible MCP clients, API clients, and adapters for model hosts that expose function calling but not MCP.

The verification engine is authoritative. Host-specific UI is presentation only.

## Customer-source-only mode

A user must be able to ask an AI host to audit a claim or answer entirely against source material supplied by that customer.

Every audit request therefore carries an explicit source policy:

- `customer_only`: ProofTTL may use only supplied source material. No open-web retrieval. No model world knowledge as evidence.
- `customer_plus_public`: supplied customer sources are primary, with optional public-source challenge/reconciliation.
- `public_only`: legacy public-source verification path.

For `customer_only`, absence of evidence MUST resolve to `UNKNOWN` / insufficient evidence rather than silently searching elsewhere.

## Source objects

A source is normalized into a host-neutral record before verification.

```json
{
  "source_id": "src_...",
  "kind": "url|text|file",
  "label": "Customer policy PDF",
  "origin": "customer",
  "content_type": "application/pdf",
  "canonical_url": null,
  "observed_at": "ISO-8601",
  "sha256": "sha256:...",
  "extracted_text_sha256": "sha256:..."
}
```

Raw secrets, authentication headers, signed file URLs, or transient host tokens must never be copied into Fact Lease payloads.

## Core host workflow

User intent:

> Audit this answer using only the source I attached, then create a Fact Lease for every consequential claim that the source actually supports.

Host workflow:

1. Collect the customer's source(s).
2. Call `audit_output` with `source_policy=customer_only`.
3. ProofTTL decomposes the answer into atomic factual claims.
4. Consequence/risk ranking determines which claims require verification.
5. Each claim is checked only against the supplied source corpus.
6. Evidence spans are returned with source IDs and exact offsets/hashes where practical.
7. Unsupported, contradictory, mixed, stale, or insufficient claims are never upgraded to SUPPORTED.
8. The host shows the audit result.
9. After user approval where required, call `create_fact_lease` for selected supported claims.
10. Return lease IDs and cryptographic provenance.

## Minimal MCP tools

The target surface should remain small:

### audit_claim

Verify one atomic factual claim against supplied sources.

Input:
- claim
- sources[]
- source_policy
- as_of (optional)
- consequence (optional hint)

Output:
- audit_id
- verdict
- evidence[]
- conflicts[]
- source_ids[]
- observed_at
- verifier metadata
- reasons[]
- lease_eligible

### audit_output

Audit a larger AI/human output.

Input:
- output_text
- sources[]
- source_policy
- max_claims
- consequence_threshold

Output:
- audit_id
- extracted_claims[]
- claim_results[]
- omitted_claims[]
- summary counts

### challenge_claim

Adversarially search the supplied corpus (and only allowed source domain under the policy) for evidence that weakens a proposed supported verdict.

### compare_evidence

Reconcile multiple supplied sources and expose agreement, disagreement, scope, date, jurisdiction, population, and authority differences without hiding conflicts.

### create_fact_lease

Create a lease from a completed, lease-eligible audit result.

Must accept an `audit_id` and `claim_result_id` rather than trusting a host-supplied verdict.

This prevents a model from fabricating `SUPPORTED` and directly minting a lease.

### get_fact_lease

Read the current state and provenance of one lease.

### watch_claim

Optional monitoring registration. This should remain separate from lease creation because customer-only uploaded files may be immutable and not meaningfully monitorable.

## Fact Lease invariants

A Fact Lease created from a customer-supplied source must bind:

- normalized atomic claim
- issued verdict
- source IDs
- source content hashes
- exact evidence text or evidence hash + offsets
- source policy
- observed timestamp
- expiration/freshness rule
- verifier version
- audit ID
- lease state
- signature/attestation when enabled

A lease must NOT claim that ProofTTL established universal truth. It establishes what the bound evidence supported at the observed time.

## Inline host UI

The preferred visual is an MCP Apps component, not a separate website.

The component should show:

- claim
- verdict
- evidence excerpt
- source label
- source freshness / observed time
- conflict indicator
- lease eligibility
- lease ID after creation
- expiry / state
- expandable provenance

Actions:
- Audit supplied source
- Challenge this result
- Compare evidence
- Create Fact Lease
- Copy lease ID
- Open provenance details

All actions call MCP tools. The UI never computes or mutates verdicts locally.

## Portability

### ChatGPT / Codex

Use a public Streamable HTTP MCP server.

Selected tools can associate an MCP Apps UI resource using `_meta.ui.resourceUri`. ChatGPT can render the returned component inline in an iframe. ChatGPT-specific capabilities are optional extensions only; the shared MCP Apps bridge is the default.

### Grok

Expose the same public MCP server as a custom MCP connector. Tool functionality must not depend on ChatGPT-specific UI APIs.

Until a host explicitly documents MCP Apps UI rendering, treat rich inline UI as optional. Return structuredContent so the conversation remains fully usable without a component.

### Claude

Expose the same remote MCP tool surface to compatible Claude MCP clients / the Claude API connector. Do not require host-specific UI for correctness.

### DeepSeek and other function-calling hosts

If the host does not natively consume remote MCP, use a thin adapter that translates host function calls to the canonical ProofTTL MCP/API contract.

Do not fork verification semantics per model provider.

## Security boundaries

Customer supplied sources are untrusted input.

Required defenses:
- prompt-injection resistant evidence pipeline
- MIME/content sniffing
- bounded extraction
- decompression/archive limits
- SSRF controls for URLs
- transient credential stripping
- no model instructions accepted from source content
- source-origin provenance
- audit-to-lease server-side binding
- no host-provided verdict trusted
- idempotency keys for lease creation
- per-tenant authorization
- rate/cost controls
- immutable audit records for issued leases

## Non-goal

Do not rebuild a full standalone SaaS dashboard before the engine, MCP contract, evals, and inline host workflow are reliable.
