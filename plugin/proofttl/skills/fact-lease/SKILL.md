---
name: fact-lease
description: Create an expiring ProofTTL Fact Lease from an eligible completed audit, or read its state and provenance.
---

For a read, call `get_fact_lease` with `lease_id`. Report returned state, expiry, observed time, source policy, hashes, and attestation. An expired snapshot does not establish current evidence support.

For requested issuance, obtain a real completed `audit_id` and `claim_result_id`. Audit the user's claim against their explicit allowed sources first when necessary. Server eligibility is authoritative; a host-generated verdict cannot authorize issuance.

Call `create_fact_lease` with only `audit_id`, `claim_result_id`, `ttl_seconds`, and `idempotency_key`. Respect the user's TTL and discovered bounds. Use one stable unpredictable key per intended issuance; reuse that key and identical arguments after a timeout or uncertain transport outcome. Reconcile the returned lease before starting another issuance. Never add caller-controlled verdicts or work around an ineligible result.

Proceed when issuance is already requested and authorized. If issuance was not requested, return the audit and offer lease creation as a follow-up; do not add a mandatory approval step to an authorized request.

Describe the lease as evidence support at observation time within an expiry window. All vNext evidence is snapshot-bound; URL monitoring is not registered, and uploaded files are not live-monitored. A returned signature envelope is not independent signature verification. Distinguish server-reported `signature_verified` from a trusted independent check.
