# ProofTTL MCP demonstration: one lease, six inspectable observations

Recorded on September 29, 2026. This is a public integration-test report generated from real ProofTTL MCP responses. It is not a customer audit, an independent accuracy benchmark, or a verification of the earlier RAG claim.

## 1. Returned result

The bounded Example Domain fixture returned `SUPPORTED` for the literal claim `Example Domain`, with `EXACT_TEXT` as its proof basis.

- Source: https://example.com/
- Returned evidence: `Example Domain`
- Lease ID: `ftl_aacd913142d442cb93fb584bd2266ca5`
- Issued at: `2026-09-29T10:03:48.871Z`
- Raw record: https://proofttl.tasx13ok.workers.dev/lease/ftl_aacd913142d442cb93fb584bd2266ca5

The result establishes that the checked source contained the tested text. It does not establish broad factual accuracy across subjects.

## 2. Created and retrieved

ProofTTL's MCP round-trip action returned these checks:

- `created: true`
- `retrieved: true`
- `lease_ids_match: true`

The complete creation and retrieval payloads below carry the same lease ID. This demonstrates the observed creation/storage/retrieval round trip for this fixture.

## 3. Exact text evidence

The returned fields were:

- `claim: "Example Domain"`
- `evidence: "Example Domain"`
- `reason: "exact_claim_text_found_in_source"`
- `verifier: "deterministic-exact-match"`

This was a deterministic text-match result. It was not a semantic assessment of a complex real-world assertion. The response's confidence value is reproduced as returned in the appendix; this report does not interpret it as a calibrated probability of general factual correctness.

## 4. Source fingerprint

ProofTTL stored this source fingerprint:

`sha256:a1082fcfb96ecf38cd975a773a89a135704f454bf20ccbce1de18db6ce025f21`

The original and latest recorded source fingerprints match. A stored fingerprint allows an observed source representation to be compared with another observation. A hash alone does not prove that a claim is true or that a source is authoritative.

## 5. Automatic checks

The later MCP retrieval contains two automatic source-check history entries:

| Time (UTC) | History event | Returned result | Stored verdict |
|---|---|---|---|
| 2026-09-29T10:06:25.000Z | AUTO_REVERIFY | UNCHANGED_SOURCE | SUPPORTED |
| 2026-09-29T10:08:25.000Z | AUTO_REVERIFY | UNCHANGED_SOURCE | SUPPORTED |

The returned `verification_count` is 3, including the initial issuance. These entries show recorded automatic checks for this lease. They do not demonstrate a source-change/revocation scenario, universal monitoring reliability, or delivery of a seven-day commercial audit watch.

## 6. Expiry and verdict are different fields

- Issued: `2026-09-29T10:03:48.871Z`
- Expired: `2026-09-29T10:08:48.871Z`
- TTL: `300` seconds
- Later lease state: `EXPIRED`
- Stored current verdict: `SUPPORTED`
- Next check: `null`

The later response simultaneously reports an expired lease and a stored supported verdict. Expiration ended this lease's freshness window. It did not record a contradiction. This report is a historical snapshot; readers should inspect the current record before relying on its freshness.

## Scope of the six social posts

All six posts refer to this one recorded MCP demonstration. They are not six independent claim audits. No custom claim verdict or RAG Fact Lease was issued. No customer, revenue, accuracy score, cryptographic signature, or paid verification is claimed.

The public MCP offers service checks, public lease retrieval, and a bounded fixed-fixture test. Its service-information response says arbitrary unpaid verification is not exposed.

## Complete creation and retrieval response

```json
{
  "ok": true,
  "test": "fact_lease_roundtrip",
  "server_version": "0.4.1",
  "toolset_version": "5",
  "lease_id": "ftl_aacd913142d442cb93fb584bd2266ca5",
  "checks": {
    "created": true,
    "retrieved": true,
    "lease_ids_match": true
  },
  "created": {
    "lease_id": "ftl_aacd913142d442cb93fb584bd2266ca5",
    "protocol": "ProofTTL/0.3.1",
    "claim": "Example Domain",
    "status": "SUPPORTED",
    "source_url": "https://example.com/",
    "final_url": "https://example.com/",
    "evidence": "Example Domain",
    "reason": "exact_claim_text_found_in_source",
    "issued_at": "2026-09-29T10:03:48.871Z",
    "observed_at": "2026-09-29T10:03:48.871Z",
    "expires_at": "2026-09-29T10:08:48.871Z",
    "ttl_seconds": 300,
    "source_fingerprint": "sha256:a1082fcfb96ecf38cd975a773a89a135704f454bf20ccbce1de18db6ce025f21",
    "last_source_fingerprint": "sha256:a1082fcfb96ecf38cd975a773a89a135704f454bf20ccbce1de18db6ce025f21",
    "confidence": 0.99,
    "verifier": "deterministic-exact-match",
    "proof_basis": "EXACT_TEXT",
    "lease_state": "ACTIVE",
    "verification_count": 1,
    "last_checked_at": "2026-09-29T10:03:48.871Z",
    "last_check": {
      "kind": "ISSUED",
      "checked_at": "2026-09-29T10:03:48.871Z",
      "result": "VERIFIED",
      "status": "SUPPORTED",
      "evidence": "Example Domain",
      "reason": "exact_claim_text_found_in_source",
      "confidence": 0.99,
      "verifier": "deterministic-exact-match",
      "source_fingerprint": "sha256:a1082fcfb96ecf38cd975a773a89a135704f454bf20ccbce1de18db6ce025f21",
      "final_url": "https://example.com/"
    },
    "history": [
      {
        "kind": "ISSUED",
        "checked_at": "2026-09-29T10:03:48.871Z",
        "result": "VERIFIED",
        "status": "SUPPORTED",
        "evidence": "Example Domain",
        "reason": "exact_claim_text_found_in_source",
        "confidence": 0.99,
        "verifier": "deterministic-exact-match",
        "source_fingerprint": "sha256:a1082fcfb96ecf38cd975a773a89a135704f454bf20ccbce1de18db6ce025f21",
        "final_url": "https://example.com/"
      }
    ],
    "monitor_interval_seconds": 100,
    "next_check_at": "2026-09-29T10:05:28.871Z",
    "issued_status": "SUPPORTED",
    "current_status": "SUPPORTED",
    "test_fixture": true,
    "reused": false
  },
  "retrieved": {
    "lease_id": "ftl_aacd913142d442cb93fb584bd2266ca5",
    "protocol": "ProofTTL/0.3.1",
    "claim": "Example Domain",
    "status": "SUPPORTED",
    "source_url": "https://example.com/",
    "final_url": "https://example.com/",
    "evidence": "Example Domain",
    "reason": "exact_claim_text_found_in_source",
    "issued_at": "2026-09-29T10:03:48.871Z",
    "observed_at": "2026-09-29T10:03:48.871Z",
    "expires_at": "2026-09-29T10:08:48.871Z",
    "ttl_seconds": 300,
    "source_fingerprint": "sha256:a1082fcfb96ecf38cd975a773a89a135704f454bf20ccbce1de18db6ce025f21",
    "last_source_fingerprint": "sha256:a1082fcfb96ecf38cd975a773a89a135704f454bf20ccbce1de18db6ce025f21",
    "confidence": 0.99,
    "verifier": "deterministic-exact-match",
    "proof_basis": "EXACT_TEXT",
    "lease_state": "ACTIVE",
    "verification_count": 1,
    "last_checked_at": "2026-09-29T10:03:48.871Z",
    "last_check": {
      "kind": "ISSUED",
      "checked_at": "2026-09-29T10:03:48.871Z",
      "result": "VERIFIED",
      "status": "SUPPORTED",
      "evidence": "Example Domain",
      "reason": "exact_claim_text_found_in_source",
      "confidence": 0.99,
      "verifier": "deterministic-exact-match",
      "source_fingerprint": "sha256:a1082fcfb96ecf38cd975a773a89a135704f454bf20ccbce1de18db6ce025f21",
      "final_url": "https://example.com/"
    },
    "history": [
      {
        "kind": "ISSUED",
        "checked_at": "2026-09-29T10:03:48.871Z",
        "result": "VERIFIED",
        "status": "SUPPORTED",
        "evidence": "Example Domain",
        "reason": "exact_claim_text_found_in_source",
        "confidence": 0.99,
        "verifier": "deterministic-exact-match",
        "source_fingerprint": "sha256:a1082fcfb96ecf38cd975a773a89a135704f454bf20ccbce1de18db6ce025f21",
        "final_url": "https://example.com/"
      }
    ],
    "monitor_interval_seconds": 100,
    "next_check_at": "2026-09-29T10:05:28.871Z",
    "issued_status": "SUPPORTED",
    "current_status": "SUPPORTED"
  }
}
```

## Later retrieval showing automatic checks and expiry

```json
{
  "lease_id": "ftl_aacd913142d442cb93fb584bd2266ca5",
  "protocol": "ProofTTL/0.3.1",
  "claim": "Example Domain",
  "status": "SUPPORTED",
  "source_url": "https://example.com/",
  "final_url": "https://example.com/",
  "evidence": "Example Domain",
  "reason": "exact_claim_text_found_in_source",
  "issued_at": "2026-09-29T10:03:48.871Z",
  "observed_at": "2026-09-29T10:03:48.871Z",
  "expires_at": "2026-09-29T10:08:48.871Z",
  "ttl_seconds": 300,
  "source_fingerprint": "sha256:a1082fcfb96ecf38cd975a773a89a135704f454bf20ccbce1de18db6ce025f21",
  "last_source_fingerprint": "sha256:a1082fcfb96ecf38cd975a773a89a135704f454bf20ccbce1de18db6ce025f21",
  "confidence": 0.99,
  "verifier": "deterministic-exact-match",
  "proof_basis": "EXACT_TEXT",
  "lease_state": "EXPIRED",
  "verification_count": 3,
  "last_checked_at": "2026-09-29T10:08:25.000Z",
  "last_check": {
    "kind": "AUTO_REVERIFY",
    "checked_at": "2026-09-29T10:08:25.000Z",
    "result": "UNCHANGED_SOURCE",
    "status": "SUPPORTED",
    "source_fingerprint": "sha256:a1082fcfb96ecf38cd975a773a89a135704f454bf20ccbce1de18db6ce025f21",
    "final_url": "https://example.com/"
  },
  "history": [
    {
      "kind": "ISSUED",
      "checked_at": "2026-09-29T10:03:48.871Z",
      "result": "VERIFIED",
      "status": "SUPPORTED",
      "evidence": "Example Domain",
      "reason": "exact_claim_text_found_in_source",
      "confidence": 0.99,
      "verifier": "deterministic-exact-match",
      "source_fingerprint": "sha256:a1082fcfb96ecf38cd975a773a89a135704f454bf20ccbce1de18db6ce025f21",
      "final_url": "https://example.com/"
    },
    {
      "kind": "AUTO_REVERIFY",
      "checked_at": "2026-09-29T10:06:25.000Z",
      "result": "UNCHANGED_SOURCE",
      "status": "SUPPORTED",
      "source_fingerprint": "sha256:a1082fcfb96ecf38cd975a773a89a135704f454bf20ccbce1de18db6ce025f21",
      "final_url": "https://example.com/"
    },
    {
      "kind": "AUTO_REVERIFY",
      "checked_at": "2026-09-29T10:08:25.000Z",
      "result": "UNCHANGED_SOURCE",
      "status": "SUPPORTED",
      "source_fingerprint": "sha256:a1082fcfb96ecf38cd975a773a89a135704f454bf20ccbce1de18db6ce025f21",
      "final_url": "https://example.com/"
    }
  ],
  "monitor_interval_seconds": 100,
  "next_check_at": null,
  "issued_status": "SUPPORTED",
  "current_status": "SUPPORTED"
}
```

## Service boundary response

```json
{
  "service": "ProofTTL",
  "website": "https://proofttl-web.vercel.app/",
  "technical_api": "https://proofttl.tasx13ok.workers.dev",
  "purpose": "Source-backed verification of specific factual claims, with explicit SUPPORTED, CONTRADICTED, or UNKNOWN outcomes and expiring Fact Leases.",
  "commercial": {
    "rapid_claim_check": "https://proofttl-web.vercel.app/audit/",
    "services": "https://proofttl-web.vercel.app/services/",
    "sample_report": "https://proofttl-web.vercel.app/audit/sample/"
  },
  "mcp": {
    "server_version": "0.4.1",
    "toolset_version": "5",
    "tools": [
      "proofttl_status",
      "proofttl_capabilities",
      "proofttl_get_fact_lease",
      "proofttl_create_test_fact_lease",
      "proofttl_fact_lease_roundtrip_test",
      "proofttl_service_info"
    ],
    "canonical_endpoint": "https://proofttl-web.vercel.app/api/mcp/"
  },
  "boundaries": [
    "This public MCP test surface is read-only except for one bounded fixed test-lease action. Cached clients can invoke the same bounded round-trip through proofttl_get_fact_lease with lease_id __roundtrip_test__.",
    "The fixed test action can only verify the Example Domain fixture and does not expose arbitrary unpaid POST /verify.",
    "It does not create audit intakes, charge cards, access private reports, or mutate accounts.",
    "ProofTTL records what examined evidence supports at a point in time; it is not a permanent-truth oracle."
  ]
}
```
