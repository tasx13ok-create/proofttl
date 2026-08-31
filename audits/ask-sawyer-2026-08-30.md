# ProofTTL Fact Audit — Ask Sawyer

Audit date: 2026-08-30
Target surface: Ask Sawyer public federal Advisor Agreement Law page
Target page: https://asksawyer.ai/law/federal/documents/advisor-agreement/rules/
Page states: Last reviewed 2026-07-13

Status: PRE-OUTREACH EVIDENCE PACKET

## Executive read

The public page contains at least two high-confidence legal accuracy failures and one material overstatement. The strongest finding is temporal: the page says an SEC proposal remains proposed even though the SEC formally withdrew it more than a year before the page's stated review date.

Do not describe this as a generic 'AI hallucination.' Describe exactly what is wrong, cite the primary authority, and let the evidence carry the pitch.

## Finding 1 — Withdrawn SEC proposal represented as still pending

Severity: HIGH
Verdict: CONTRADICTED / STALE
Confidence: HIGH

### Published claim

Under Proposed Rule Changes, Sawyer states that the SEC Safeguarding Rule, Release IA-6240, 'remains proposed and has not been finalized' and that no adoption/effective date/final text has been established. The page is marked Last reviewed: 2026-07-13.

### Primary-source evidence

SEC — Safeguarding Advisory Client Assets:
https://www.sec.gov/rules-regulations/2025/06/safeguarding-advisory-client-assets

The SEC states that it formally withdrew the relevant notices of proposed rulemaking, does not intend to issue final rules from those proposals, and would need to issue a new proposal for future action. The SEC page identifies S7-04-23 / IA-6240 and gives an effective withdrawal date of 2025-06-17.

### Why the claim fails

The distinction is not merely 'not finalized.' By the page's claimed review date, IA-6240 had been formally withdrawn for more than a year. A withdrawn proposal is materially different from a live pending proposal.

### User consequence

A user reviewing an investment-adviser agreement could be told to account for a regulatory proposal that is no longer pending, distorting compliance planning and legal diligence.

### Repair

Mark S7-04-23 / IA-6240 as withdrawn effective 2025-06-17. Separate the current custody-rule requirements from the abandoned Safeguarding proposal. If discussing possible future changes, state that future Commission action would require new rulemaking.

---

## Finding 2 — Federal law overstated as requiring a written advisory contract for SEC-registered advisers generally

Severity: HIGH
Verdict: OVERSTATED / SCOPE ERROR
Confidence: HIGH

### Published claim

Sawyer answers 'Does my investment adviser need a written contract with me?' with: 'A written investment advisory contract is legally required for advisers registered with the SEC.'

### Primary statutory evidence

Investment Advisers Act §205, 15 U.S.C. §80b-5:
https://www.law.cornell.edu/uscode/text/15/80b-5

Section 205 regulates the substance of investment advisory contracts for advisers registered or required to be registered with the SEC, including performance compensation, assignment, and partnership-change provisions. Its definition expressly covers any 'contract or agreement.' It does not impose the blanket federal writing requirement asserted on the Sawyer page.

By contrast, Investment Company Act §15(a), 15 U.S.C. §80a-15, expressly requires a written contract when a person serves as investment adviser to a registered investment company:
https://www.law.cornell.edu/uscode/text/15/80a-15

This contrast matters: Congress used an explicit writing requirement for the registered-investment-company context, while the cited Advisers Act provision does not establish the blanket rule Sawyer states.

### Why the claim fails

The page converts a common/prudent practice and requirements that may arise in specific contexts or under state law into a universal federal rule for SEC-registered advisers. Its following sentence partly acknowledges the tension by saying oral agreements are 'theoretically possible.' Both statements cannot comfortably coexist as written.

### User consequence

A small business, adviser, or client could mistake best practice or a context-specific/state requirement for a categorical federal statutory requirement.

### Repair

State that Section 205 requires specified substantive provisions in covered advisory contracts, while a blanket written-contract requirement should not be attributed to federal law for every SEC-registered adviser without a more specific authority. Then identify contexts where writing is expressly required, including advisers to registered investment companies under Investment Company Act §15(a), and applicable state rules.

---

## Finding 3 — 'Absolute right to veto any sale or transfer' overstates the statutory assignment rule

Severity: MEDIUM
Verdict: OVERBROAD
Confidence: HIGH

### Published claim

Sawyer states: 'The mandatory anti-assignment clause gives you an absolute right to veto any sale or transfer of your advisory relationship.'

### Primary-source evidence

17 C.F.R. §275.202(a)(1)-1:
https://www.law.cornell.edu/cfr/text/17/275.202%28a%29%281%29-1

The SEC rule states that a transaction that does not result in a change of actual control or management of an investment adviser is not an assignment for purposes of Advisers Act §205(a)(2).

15 U.S.C. §80b-2(a)(1) also defines assignment and contains partnership exceptions:
https://www.law.cornell.edu/uscode/text/15/80b-2

### Why the claim needs qualification

Client consent is central when a transaction constitutes an assignment, but not every sale, transfer, ownership movement, or transaction is legally an assignment. Calling the right 'absolute' across 'any sale or transfer' erases the actual-control/management limitation and statutory exceptions.

### Repair

Replace the absolute formulation with: client consent is required when a transaction constitutes an assignment under the Advisers Act and applicable rules; certain transactions that do not change actual control or management are not deemed assignments.

---

## Why this target is commercially qualified

Ask Sawyer markets answers as sourced from actual statutes, regulations, and case law and says citations link to primary sources. It also says it covers the law small businesses encounter and 'refuses to bluff about the rest.' These findings therefore hit the product's explicit trust proposition rather than an incidental marketing detail.

Public contact route discovered: legal@asksawyer.ai (published in site Terms). Public reporting also identifies Amos Elberg as the founder of Ask Sawyer.

## Outreach lead

Lead with Finding 1 only. It is the cleanest, newest, easiest to verify, and directly conflicts with a page marked reviewed in July 2026. Hold Findings 2 and 3 in reserve. Their existence makes the proposed paid audit credible without dumping the entire audit for free.

Suggested proof-page headline:

> A rule Sawyer marked as still proposed in July 2026 had been formally withdrawn by the SEC in June 2025.

## Evidence discipline

- No claim here should be represented as legal advice.
- Preserve screenshots/time-stamped copies before outreach because the target can update the page.
- Prefer the SEC source for Finding 1 in the customer-facing artifact.
- Finding 2 is a scope/overstatement finding, not a claim that written contracts are bad practice.
- Finding 3 is an overbreadth finding, not a claim that assignment consent is generally unnecessary.
