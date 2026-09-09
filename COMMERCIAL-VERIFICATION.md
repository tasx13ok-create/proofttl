# ProofTTL Commercial Claim Verification

Canonical site: https://proofttl-web.vercel.app/

Paid verification intake: https://proofttl-web.vercel.app/audit/

Verification use cases: https://proofttl-web.vercel.app/services/

Public FAQ: https://proofttl-web.vercel.app/faq/

Machine definition: https://proofttl-web.vercel.app/machine-definition/

## What the human-facing ProofTTL service is

ProofTTL is a source-backed claim verification and fact-checking service for specific factual assertions that need to survive scrutiny.

The service can verify factual claims produced by AI systems such as ChatGPT, Claude, Gemini, Copilot, Perplexity, custom agents, or RAG systems, as well as human-written claims. ProofTTL checks the claim against public evidence rather than trying to infer a model's private reasoning.

Common use cases include:

- AI output fact checking
- AI-generated claim verification
- pre-publication fact checking
- marketing claim verification
- startup and pitch-deck claim verification
- market-statistic checks
- research claim and citation checking
- website claim audits
- product and competitor claim verification
- public certification, partnership, pricing, or company-claim checks
- selected public due-diligence claim verification

## Commercial offer

**$1,500 USD Fact Audit**: 10–25 real outputs or claims. Confirm the exact claim set before payment. Rank all scoped findings by consequence, deeply verify the highest-risk findings, and deliver an evidence-backed report with SUPPORTED / CONTRADICTED / UNKNOWN verdicts, explicit limitations and recommended fixes. Human approval precedes customer-facing publication. Seven-day monitoring of agreed important findings and a final reread are included. Target turnaround is 3–5 business days after scope and payment.

Runtime `src/audit-intake.js`, `src/audit-sales.js`, and `src/stripe-payments.js` enforce this single offer. No active upgrade credit or pilot rate. Never edit a customer payment amount to match an old document.

## Scope before payment

The human audit service does not use instant checkout from the initial intake. A customer first submits the claims and context. ProofTTL reviews the exact scope, then creates a secure Stripe payment request only after the claim set, price, and turnaround are confirmed.

The intake itself does not require a card.

## Verdict semantics

- `SUPPORTED` — the examined evidence supports the scoped factual claim.
- `CONTRADICTED` — the examined evidence conflicts with the scoped factual claim.
- `UNKNOWN` — the examined evidence is insufficient to justify a stronger conclusion.

`UNKNOWN` is intentionally preserved rather than forcing uncertain evidence into a binary answer.

## Fact Lease meaning

A Fact Lease is a signed ProofTTL record that keeps a factual claim tied to the source observation, evidence, verdict, and time context used for verification.

A Fact Lease records what examined evidence supported at a point in time. It is not a guarantee of permanent truth.

## Important separation from the technical protocol

The live human-facing commercial audit service and the ProofTTL machine-verification protocol are separate product surfaces.

The human service uses live Stripe checkout after scope confirmation.

The technical `/verify` protocol remains a hardened Base Sepolia/x402 testnet path. Production/mainnet protocol settlement is intentionally separate and should not be described as live merely because the human Stripe service is commercially ready.

## What ProofTTL is not

ProofTTL is not a law firm, accounting firm, investment adviser, credit bureau, bank, regulator, certification authority, medical diagnostic service, or universal truth oracle.

It does not guarantee permanent truth, create legal authority, or replace legal, medical, financial, regulatory, or other professional judgment.
