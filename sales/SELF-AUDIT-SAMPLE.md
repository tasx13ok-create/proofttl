# ProofTTL self-audit: a stale price can survive a working checkout

Observed: 2026-09-09. Scope: public ProofTTL repository commit fc8bb7b5762cacb708225ae7ca7fb88e7ca37c09 and the public buyer page. This is a self-audit, not commissioned customer work or a certification.

**Claim:** “The current ProofTTL full audit costs $500.”

**Verdict: CONTRADICTED for the active commercial code and buyer-facing offer examined.**

Supporting evidence for the mistaken claim: the backend README at that commit lists a “$500 Full Verification Audit.” A reader relying only on it could quote the retired price.

Contradicting evidence: src/audit-intake.js advertises full_audit at 1500 USD; src/audit-sales.js rejects a scoped price other than 1500; src/stripe-payments.js sets FACT_AUDIT_PRICE_USD to 1500 and creates Stripe line-item cents from that amount. The public /audit/ page advertises $1,500 with scope confirmation before payment.

Immutable source links:
- https://github.com/tasx13ok-create/proofttl/blob/fc8bb7b5762cacb708225ae7ca7fb88e7ca37c09/README.md
- https://github.com/tasx13ok-create/proofttl/blob/fc8bb7b5762cacb708225ae7ca7fb88e7ca37c09/src/audit-intake.js
- https://github.com/tasx13ok-create/proofttl/blob/fc8bb7b5762cacb708225ae7ca7fb88e7ca37c09/src/audit-sales.js
- https://github.com/tasx13ok-create/proofttl/blob/fc8bb7b5762cacb708225ae7ca7fb88e7ca37c09/src/stripe-payments.js
- Mutable public offer: https://proofttl-web.vercel.app/audit/

Consequence: an owner could send an obsolete quote; a customer could encounter contradictory prices. No lost customer or revenue is claimed here.

Recommended repair: align active README, sales material and readiness offer identifiers to $1,500; preserve historical records and never silently alter payment amounts. The local repair changes documentation/diagnostics, not the checkout price.

Uncertainty: source inspection and mocked Stripe tests do not prove every historical customer session used this amount. No charge was created. This record does not inspect private Stripe transactions or assert that all payment scenarios work.

Freshness: recheck before each quote and after pricing/deployment changes. The commit evidence is immutable; the public offer is time-sensitive. No Fact Lease or independent human certification was issued for this sample. Owner editorial review is required before sharing as a human-approved commercial deliverable.
