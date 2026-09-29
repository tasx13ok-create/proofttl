# ProofTTL Software-First / Universal AI Integration Handoff

**Audience:** Astra / Codex operating in ChatGPT Work or Codex with repository and Cloudflare access.

**Execution profile:** GPT-6.1 Sol in Codex, maximum available reasoning effort. Preserve this model selection for the implementation run unless the user explicitly changes it. Do not silently downgrade model or reasoning level.

**Repository:** `tasx13ok-create/proofttl`

**Do not work from the website repository.** The active product direction is the verification engine, MCP, skills, provider integrations, and host-native UI.

**Current implementation branch:** `feature/software-first-core`

**Base:** `main`

## 0. Mission

ProofTTL should become a provider-independent verification layer that AI systems can call before presenting consequential factual claims as reliable.

The product must never claim omniscience or universal truth. Its job is to make unsupported certainty difficult to ship.

The architectural target is:

```text
AI host / agent
    |
    v
ProofTTL canonical MCP / API
    |
    +--> customer-source ingestion
    +--> claim extraction
    +--> consequence classification
    +--> adversarial verification
    +--> evidence reconciliation
    +--> freshness / provenance
    +--> Fact Lease issuance
    +--> monitoring / revocation when meaningful
    |
    v
portable signed verification artifact
```

A lease proves what specified evidence supported at a specified observation time. It does not prove permanent or universal truth.

---

## 1. Hard truth about the current repository

The repository already contains real infrastructure:

- source-backed verification
- `SUPPORTED / CONTRADICTED / UNKNOWN`
- public URL safety / SSRF controls
- bounded source reads
- exact-match and semantic verification
- source fingerprints
- Fact Lease persistence
- automatic monitoring / revocation
- KV + D1 scheduling/indexing
- Ed25519 issuance/event signing
- x402 testnet payment path
- Better Auth/account foundations
- regression/security/cost/economic tests

However, it is not yet the universal system described above.

### The most important current gaps

1. **There is not yet a production Streamable HTTP MCP endpoint.**
   `/mcp/test-lease` is a convenience route, not an MCP server.

2. **The verifier is not proven robust enough.**
   A previous deterministic exact-match path could label a verbatim sentence as supported without sufficiently understanding whether the source was quoting, refuting, superseding, or hypothetically mentioning it. The software-first branch adds a conservative guard and adversarial tests, but this is still heuristic and must be attacked further.

3. **The benchmark is too small and synthetic.**
   A few dozen semantic fixtures are not enough to justify high-confidence reliability claims.

4. **Customer-supplied files are not yet a first-class source corpus.**
   The desired workflow requires files/text/URLs supplied inside an AI host.

5. **Fact Lease creation is not yet bound to a server-authoritative completed audit object.**
   The future `create_fact_lease` tool must never accept a host/model-provided verdict.

6. **The Worker has substantial unrelated surface area.**
   `src/worker.js` includes assistant, studio, account actions, automations, files, tasks, owner desk, cinematics, Discord, Foundry, and other product functionality. Do not expose these through the verification MCP server. Long-term, isolate verification from unrelated runtime complexity.

7. **The product has no completed cross-provider compatibility suite.**
   A tool that works in one host is not "universal" until the same contract is exercised against multiple real clients.

8. **A native rich UI is host-dependent.**
   ChatGPT implements MCP Apps. Other hosts may support tools without the same UI. Verification correctness must never depend on the widget.

---

## 2. Existing software-first work

Inspect the branch before changing it.

The branch currently contains:

- hardened deterministic exact-match context handling in `src/index.js`
- `scripts/adversarial-verifier-test.js`
- local test-gate wiring in `package.json`
- `docs/AI-HOST-INTEGRATION.md`
- `specs/mcp-tools.design.json`

Do not assume any test passed unless you run it yourself.

The current exact-match hardening is not a final solution. Treat it as an attack target.

---

## 3. Required execution environment / plugins / MCPs

### ChatGPT Work plugins

Use these when available:

1. **GitHub**
   - Required.
   - Repository inspection, branches, commits, PRs, CI.
   - Work only on an isolated branch.
   - Never push directly to `main`.

2. **OpenAI Developers**
   - Required for current OpenAI plugin / MCP / Skills / MCP Apps guidance.
   - Do not rely on remembered plugin formats.

3. **Vercel**
   - Currently installed but **not a core dependency for this phase**.
   - The website is frozen/minimal. Do not spend engineering time on Vercel unless an authentication callback or required public static asset blocks the core integration.

### Cloudflare

A ChatGPT Plugin Directory search may not expose a dedicated Cloudflare plugin. Do not treat that as lack of Cloudflare agent support.

For **Codex**, connect Cloudflare's official MCP servers.

Cloudflare API:
```bash
codex mcp add cloudflare --url https://mcp.cloudflare.com/mcp
```

Cloudflare docs:
```bash
codex mcp add cloudflareDocs --url https://docs.mcp.cloudflare.com/mcp
```

Cloudflare observability:
```bash
codex mcp add cloudflareObservability --url https://observability.mcp.cloudflare.com/mcp
```

OpenAI developer docs:
```bash
codex mcp add openaiDeveloperDocs --url https://developers.openai.com/mcp
```

Verify:
```bash
codex mcp list
```

Cloudflare also publishes agent skills usable by Codex:
```bash
npx skills add https://github.com/cloudflare/skills
```

Use OAuth when prompted. Grant the minimum permissions necessary.

**Never print Cloudflare secrets, API tokens, Better Auth secrets, signing private keys, CDP credentials, Stripe credentials, or OAuth secrets into chat, logs, commits, PR bodies, or test artifacts.**

### Local CLI

The repository already uses Wrangler.

Before deployment:
```bash
npm ci
npm run test:local
npx wrangler deploy --dry-run
```

Use MCP Inspector during MCP development:
```bash
npx @modelcontextprotocol/inspector@latest
```

The deployed MCP endpoint should be tested as Streamable HTTP.

---

## 4. Current Cloudflare runtime

Primary Worker config:

- Worker name: `proofttl`
- Entry: `src/worker.js`
- Cloudflare Worker URL currently documented as:
  `https://proofttl.tasx13ok.workers.dev`
- Existing storage/bindings:
  - `LEASES` KV
  - `MONITOR_DB` D1
  - `AI` Workers AI
  - verification/payer/assistant rate-limit bindings
- Existing scheduled monitoring cron
- Existing auth/payment/signing configuration

Do not replace working D1/KV/signing infrastructure merely to make MCP easier.

Build MCP as a controlled front door over the same verification engine.

---

## 5. Target server architecture

Do **not** duplicate verification logic per provider.

Build one canonical server:

```text
                       ProofTTL core
                           |
                canonical audit service
                           |
            +--------------+--------------+
            |                             |
       REST/internal                 /mcp
                                    |
                         Streamable HTTP MCP
                                    |
       +---------------+------------+------------+
       |               |                         |
    ChatGPT          Claude                    Grok
    Codex            Gemini              Copilot Studio
    Cursor
       |
       +--> MCP Apps UI where host supports it

DeepSeek / non-MCP host
       |
       +--> thin adapter -> canonical ProofTTL API/service
```

Do not create one verifier implementation per host.

---

## 6. Canonical source policy

Implement an explicit source policy in the server-authoritative audit model.

### `customer_only`

Only evidence explicitly supplied by the customer may be used.

Allowed source types:
- URL
- text
- uploaded file / extracted snapshot

Rules:
- no open-web retrieval outside customer-provided URLs/files
- no model world knowledge as evidence
- no hidden fallback search
- missing evidence => `UNKNOWN` / insufficient evidence
- uploaded snapshots are hash-bound
- live URLs may be monitored subject to access/refresh policy

### `customer_plus_public`

Customer sources remain primary. Public evidence may be used for challenge/reconciliation, but provenance must identify which evidence is customer-supplied versus public.

### `public_only`

Legacy/current public URL verification behavior.

---

## 7. Server-authoritative audit model

Introduce a durable audit object.

Suggested minimum shape:

```json
{
  "audit_id": "aud_...",
  "tenant_id": "...",
  "source_policy": "customer_only",
  "input_hash": "sha256:...",
  "created_at": "...",
  "verifier_version": "...",
  "sources": [],
  "claim_results": []
}
```

Each claim result should have:

```json
{
  "claim_result_id": "acr_...",
  "claim": "...",
  "verdict": "SUPPORTED",
  "reasons": [],
  "evidence": [],
  "conflicts": [],
  "lease_eligible": true
}
```

The host/model may request an audit.

The host/model may **not** authoritatively set:
- verdict
- lease eligibility
- source fingerprint
- evidence provenance
- signature
- lease state

---

## 8. Minimal MCP tool surface

Do not expose the whole backend.

Start with:

### `audit_claim`

One atomic claim against an explicit source corpus.

### `audit_output`

Decompose a larger answer/output into atomic claims and audit the consequential ones.

### `challenge_claim`

Actively search within the allowed source domain/corpus for evidence that weakens a proposed result.

### `compare_evidence`

Expose conflicts such as:
- source disagreement
- date mismatch
- population mismatch
- jurisdiction mismatch
- scope mismatch
- primary vs secondary source differences

### `create_fact_lease`

Critical invariant:

```text
input = audit_id + claim_result_id + ttl + idempotency key
NOT claim + caller-provided verdict
```

The server must load the authoritative audit result and refuse non-eligible claims.

### `get_fact_lease`

Read current lease state/provenance.

### `watch_claim`

Optional. Keep monitoring separate from issuance.

Uploaded immutable snapshots should not be falsely presented as "live monitoring."

### Optional later: `search` + `fetch`

OpenAI company-knowledge compatibility may benefit from standard read-only `search` and `fetch` tools. Add only after the primary verification workflow works.

---

## 9. MCP implementation requirements

Use current official SDKs/specification.

Preferred implementation on Cloudflare:

- Streamable HTTP
- stable public HTTPS endpoint, normally `/mcp`
- official MCP SDK / Cloudflare-supported handler
- explicit tool schemas
- structuredContent
- clear tool descriptions
- correct annotations:
  - readOnlyHint
  - destructiveHint
  - idempotentHint
  - openWorldHint
- OAuth 2.1 for per-user/private data when required
- separate anonymous/public-safe capabilities where appropriate
- no secret collection through elicitation

Test:
- initialization
- tools/list
- tools/call
- invalid schemas
- oversized requests
- unauthenticated access
- cross-tenant access
- idempotency
- retries
- timeouts
- cancellation
- malformed model inputs
- prompt injection in source documents

---

## 10. Host integration matrix

### OpenAI ChatGPT / Codex

**Native path:** Plugin = Skills + MCP server + optional MCP Apps UI.

Requirements:
- public Streamable HTTP MCP endpoint
- tool schemas / annotations
- plugin package
- Skills
- optional MCP Apps component
- plugin submission/testing in developer mode

Portable plugin structure target:

```text
proofttl-plugin/
  plugin.json
  mcp.json
  skills/
    audit-claim/SKILL.md
    audit-output/SKILL.md
    evidence-challenge/SKILL.md
    fact-lease/SKILL.md
  assets/
```

Use the portable Agent Plugins schema rather than inventing a manifest.

### Claude / Anthropic

Use the same remote MCP server.

Validate:
- MCP tool calls through Claude-supported MCP connection path
- OAuth/bearer auth where needed
- tool-result compatibility

Do not require MCP Apps UI for correctness.

### Grok / xAI

Use a Custom MCP Connector pointing to the same public MCP endpoint.

Validate tool discovery and calls.

Do not assume ChatGPT's inline UI automatically renders in Grok.

### Google Gemini

Gemini's Interactions API supports remote MCP servers over **Streamable HTTP**.

Validate the same ProofTTL MCP endpoint through a Gemini integration harness.

### Microsoft Copilot Studio

Copilot Studio supports adding a reachable MCP server as a tool.

Validate tool discovery, authentication, and selected tool enablement.

### Cursor

Cursor supports remote Streamable HTTP MCP.

Provide:
- documentation
- an "Add to Cursor" path later if useful
- no custom verifier fork

### DeepSeek

Current official API exposes function/tool calling rather than a native universal remote-MCP workflow equivalent to the hosts above.

Build a thin adapter:
```text
DeepSeek function call
  -> adapter
  -> canonical ProofTTL service
  -> tool result
```

Do not reimplement business logic in the adapter.

### Other providers

Use three tiers:

1. Native remote MCP
2. Function-calling adapter
3. Plain REST/SDK

"Universal" means one canonical ProofTTL contract can reach the host through the best extension surface the host actually provides. It does **not** mean fabricating unsupported consumer-UI integration.

---

## 11. ChatGPT inline ProofTTL component

Build only after the headless MCP tools are correct.

Use MCP Apps standard first.

Attach via `_meta.ui.resourceUri`.

Target card:

```text
ProofTTL

Claim
[atomic claim]

Verdict
SUPPORTED / CONTRADICTED / MIXED / UNKNOWN / STALE / SOURCE CONFLICT

Evidence
[source excerpt]

Source
[label + provenance]

Observed
[timestamp]

Conflicts
[if any]

[Challenge] [Compare Evidence] [Create Fact Lease]

after issuance:

Lease: ftl_...
State: ACTIVE
Expires: ...
Signature: verified
[Inspect provenance]
```

Buttons call MCP tools. The component must not calculate verdicts locally.

Keep every tool usable without the component.

---

## 12. File ingestion

This is a hard part. Do not hand-wave it.

Required behavior:

1. source is accepted through a host-supported upload/file reference flow
2. server retrieves only authorized bytes
3. MIME/type is verified
4. extraction is bounded
5. archive/decompression bombs are rejected
6. raw source is hashed
7. extracted normalized text is separately hashed
8. source provenance is stored
9. transient signed URLs/auth headers are stripped
10. source content is treated as untrusted data, never as model/system instructions

Start with a deliberately limited supported set if necessary:
- text/plain
- text/html
- application/json
- PDF if robust extraction is available

Do not claim support for arbitrary documents until tested.

---

## 13. Fact Lease vNext

A customer-source Fact Lease should bind at minimum:

- lease ID
- audit ID
- claim-result ID
- normalized claim
- issued verdict
- current verdict if monitorable
- source-policy
- source identifiers
- source content hashes
- extracted-text hashes
- evidence text / offsets or evidence hashes
- observed time
- issuance time
- expiry / TTL
- verifier version
- verification method
- signature/attestation
- lease state
- revocation reason when applicable

A signed lease must never depend on a mutable model-generated explanation for its integrity.

---

## 14. Adversarial eval program

Do not ship "universal verification" on the existing small fixture set.

Build at least 100 adversarial fixtures first, then expand toward 500-1,000.

Highest-severity error:

```text
expected != SUPPORTED
actual == SUPPORTED
```

Track:
- false-SUPPORTED count
- false-CONTRADICTED count
- UNKNOWN rate
- claim extraction recall
- multi-claim decomposition accuracy
- evidence entailment
- evidence provenance completeness
- source conflict detection
- stale/freshness detection
- citation/source attachment correctness
- latency
- model/token cost
- tool-call success by host

Attack categories must include:
- quotations
- refutations
- rumors/attribution
- archived/superseded text
- historical-vs-current claims
- hidden exceptions
- conditionals
- scope/population/jurisdiction mismatch
- numbers/units/dates/time zones
- primary/secondary conflicts
- multi-claim sentences
- exact string in unrelated context
- prompt injection in sources
- HTML/JSON extraction tricks
- contradictory passages
- stale metadata
- fake citations
- source redirect/SSRF edge cases

Every reproduced false support becomes a permanent regression test.

---

## 15. Architecture cleanup

Do not delete unrelated systems during the MCP milestone.

First classify existing modules:

- CORE VERIFICATION
- REQUIRED SUPPORT
- UNRELATED PRODUCT
- DANGEROUS COUPLING

Then move toward a module boundary such as:

```text
src/
  verification/
  audits/
  evidence/
  leases/
  sources/
  mcp/
  auth/
  billing/
  legacy-product/
```

The MCP layer should import core services, not route requests back through arbitrary public HTTP endpoints.

Avoid a giant rewrite. Extract seams with tests.

---

## 16. Deployment strategy

Do not touch production first.

1. Create a new branch from the latest intended integration base.
2. Run existing deterministic tests.
3. Add failing adversarial tests.
4. Implement changes.
5. Run targeted tests.
6. Run `npm run test:local`.
7. Dry-run Wrangler.
8. Deploy a non-production / preview Worker or isolated route if the account setup permits.
9. Test with MCP Inspector.
10. Test actual host clients.
11. Only then prepare a production PR.

No direct main pushes.

No production deployment without explicit user instruction.

---

## 17. Provider compatibility test harness

Create automated integration tests where APIs/credentials are available.

At minimum produce an evidence table:

| Host | Discovery | Tool call | Auth | Structured result | UI | File-source path |
| --- | --- | --- | --- | --- | --- | --- |
| ChatGPT | | | | | | |
| Codex | | | | | | |
| Claude | | | | | | |
| Grok | | | | | | |
| Gemini | | | | | | |
| Copilot Studio | | | | | | |
| Cursor | | | | | | |
| DeepSeek adapter | | | | | | |

Never mark a cell "PASS" unless executed.

---

## 18. Skills to build

Do not make dozens.

Start with:

1. `audit-claim`
   - trigger: user wants one factual claim checked
   - defaults to customer sources when supplied
   - never invent evidence

2. `audit-output`
   - trigger: user wants an AI answer/report checked
   - extract consequential claims
   - audit and summarize failures

3. `evidence-challenge`
   - trigger: user wants to stress-test a conclusion
   - search allowed evidence for strongest contradiction/qualification

4. `fact-lease`
   - trigger: user asks to create/read a lease
   - only mint from server-authoritative eligible audit result

Keep workflow logic in skills. Keep trust/security/business invariants server-side.

---

## 19. What not to do

Do not:

- redesign the website
- add more generic chatbot features
- expose all Worker routes as MCP tools
- claim every host has the same UI capability
- let models self-certify verdicts
- let a host submit arbitrary `SUPPORTED` to mint a lease
- silently search the web in `customer_only`
- present uploaded snapshots as continuously monitored
- store transient auth URLs/tokens in leases
- put blockchain/x402 in the critical verification path unless it proves a concrete requirement
- optimize marketing before verifier reliability
- merge untested code
- print secrets

---

## 20. Required first deliverables

Create on the execution branch:

1. `docs/UNIVERSAL-INTEGRATION-AUDIT.md`
2. `docs/MCP-THREAT-MODEL.md`
3. `docs/PROVIDER-COMPATIBILITY.md`
4. `benchmark/adversarial/` corpus
5. real Streamable HTTP `/mcp`
6. headless implementations of the canonical tools
7. MCP Inspector tests
8. server-authoritative audit -> lease binding
9. customer-only source path
10. plugin package + focused Skills
11. MCP Apps ProofTTL result card after headless correctness
12. provider adapter/harnesses

---

## 21. Acceptance gates

### Gate A — verifier
- zero known false-SUPPORTED results in the adversarial release corpus
- failures are machine-readable
- no benchmark weakening to make metrics improve

### Gate B — MCP
- initialization works
- list tools works
- every advertised tool has schema tests
- malformed/unauthorized inputs fail safely
- idempotent lease creation proven

### Gate C — provenance
- every supported result used for lease issuance has attributable evidence
- evidence maps to an immutable source snapshot/hash
- host cannot substitute a different verdict

### Gate D — customer-only
- tests prove no outside evidence is used
- insufficient source data returns UNKNOWN
- source instructions cannot override verifier policy

### Gate E — cross-host
- same canonical MCP works against multiple native-MCP hosts
- adapters contain no duplicated verification semantics
- unsupported UI features are reported as unsupported, not simulated

### Gate F — production
- full repository tests pass
- Cloudflare dry run passes
- preview deployment passes
- observability shows clean initialization/tool calls
- security review complete
- explicit human approval before production deploy/merge

---

## 22. Work discipline

Act as an adversarial senior engineer.

For every change:

1. State the failure mode.
2. Reproduce it.
3. Add a failing test.
4. Implement the smallest defensible fix.
5. Run the test.
6. Run adjacent regressions.
7. Record what remains unproven.

Do not optimize for impressive output.

Optimize for evidence.

**Evidence > confidence.**
