# ProofTTL Fact Audit — Sales Pipeline

Date: 2026-08-30
Goal: close a fixed-scope manual Fact Audit before the 9-day window expires.

Scoring model: testability × consequence-if-wrong × founder/decision-maker reachability × likelihood of bypassing procurement.

## Tier A — attack first

### 1. Ask Sawyer
Surface: public U.S. small-business law library + AI answers + contract review/drafting.
Why now: public auditable corpus, explicit primary-source trust positioning, low-priced founder-stage product, direct contact.
Trust claims: sourced answers; federal/state/local law; citations to real statutes/cases; 100% of answers cited to primary legal sources.
Contact: legal@asksawyer.ai
Evidence status: AUDIT PACKET READY — `audits/ask-sawyer-2026-08-30.md`
Lead finding: page reviewed 2026-07-13 says SEC Safeguarding Rule proposal IA-6240 remains proposed; SEC formally withdrew S7-04-23 effective 2025-06-17.
Next action: preserve screenshot/time-stamped copy; prepare one-screen proof page; outreach with Finding 1 only.

### 2. LegalMind
Surface: AI contract intelligence; Q&A with page/clause citations.
Why now: unusually strong public claims — “No hallucinations” and “100% Grounded answers”; no-credit-card trial.
Target tests: exact extraction of dates/parties/renewal terms; negative questions where answer should be unknown; conflicting defined terms; cross-reference traps; OCR/layout traps.
Contact route: site contact / free trial.
Evidence status: NOT YET TESTED.

### 3. Draft Ally
Surface: free AI contract analysis; every risk flag cited to source text.
Why now: no-credit-card entry, explicit confidence levels and clause citations, product is designed for counsel but small enough to plausibly buy quickly.
Target tests: liability cap scope, indemnity asymmetry, renewal deadlines, governing-law interactions, definition chains, clauses split across schedules/exhibits.
Contact route: site contact; privacy@draftally.com is published for privacy only and should not be used as sales outreach.
Evidence status: NOT YET TESTED.

### 4. Rasind
Surface: legal research + contract review with citations; free trial without card.
Why now: explicitly markets “legal-grade accuracy” and research answers with citations.
Target tests: citation entailment, superseded case authority, jurisdiction/date sensitivity, contract cross-reference traps.
Contact route: site demo/trial.
Evidence status: NOT YET TESTED.

### 5. Pinpoint
Surface: CanLII legal research browser tool; paragraph-level citations; second verification pass.
Why now: trust proposition is directly falsifiable — product says wrong-paragraph citations are caught before the user sees them.
Target tests: holdings vs dicta, negative treatment, pin cite alignment, multi-paragraph propositions, statutory interpretation questions.
Contact route: product site.
Evidence status: NOT YET TESTED.

### 6. Atorni
Surface: Philippine legal research/drafting; free tier; citations to Supreme Court decisions and statutes.
Why now: open beta, founder-led, explicit instruction that answers can be verified against primary sources.
Founder/contact: Karl Gabriel Anciro / hello@atorni.ph
Target tests: current statutes, repealed/amended provisions, Supreme Court case holdings, jurisdiction/date-sensitive procedure.
Evidence status: ACCESS NEEDED / TESTABLE VIA FREE ACCOUNT.

## Tier B — strong but slightly more friction

### 7. Judicio
Surface: legal research and document analysis; every answer cited; 7-day no-card trial.
Why: broad jurisdiction coverage and explicit source-backed research.
Risk: larger feature surface may make buyer/reachability less direct.
Evidence status: NOT YET TESTED.

### 8. Clara
Surface: contract review for startups; 7-day no-card trial; section-referenced follow-up answers.
Why: startup-oriented price point and low access friction.
Target tests: deadlines, caps, auto-renewals, termination conditions, defined-term propagation.
Evidence status: NOT YET TESTED.

### 9. Vaquill / Quilldraft
Surface: primary-law API plus contract/research tools; free trial / free search surfaces.
Why: founder direct email and trust-centered product.
Contact: contact@vaquill.ai; founder pricing contact publicly listed as priyansh@vaquill.ai.
Caveat: current Vaquill homepage increasingly positions itself as primary-law infrastructure rather than answer generation; prioritize Quilldraft or their contract/research product if auditable outputs are available.
Evidence status: NOT YET TESTED.

### 10. Qireon
Surface: AI compliance assistant for SOC 2 / ISO 27001; 14-day no-card trial.
Why: compliance answers are consequential and framework-grounded.
Target tests: control applicability, evidence sufficiency, framework-version distinctions, prescriptive statements that exceed source controls.
Evidence status: NOT YET TESTED.

## Tier C — high consequence, use after legal lane

### 11. Syllable healthcare receptionist demo
Surface: public browser/voice/SMS healthcare receptionist agent.
Public demo phone: (209) 353-8820; SMS: (650) 297-3909.
Why: extremely testable and high-consequence front-desk information.
Target tests: office hours, provider availability, prescription-refill process, escalation boundaries, fabricated insurance/clinical details.
Constraint: do not manufacture a fictional real patient identity or seek medical advice; test published demo scenarios only.
Evidence status: NOT YET TESTED.

### 12. Healthcare voice-agent targets from prior market pass
Surface: appointment, insurance, billing, and administrative Q&A.
Why: wrong factual answers are visible and costly.
Constraint: prioritize public demo environments and avoid deceptive interactions with live healthcare staff/patients.
Evidence status: NEED LIVE-SURFACE VALIDATION.

### 13. Underwriting/compliance copilots
Surface: credit/insurance underwriting and regulatory decision support.
Why: high consequence and strong willingness to pay.
Constraint: demo access and procurement friction are usually higher; only pursue founder-stage vendors with an exposed test surface.
Evidence status: SECOND-WAVE.

## Kill criteria

Drop a target immediately if any of the following are true:
- No output can be tested without a sales call or enterprise contract.
- Finding depends on subjective style rather than a factual/entailment error.
- Error cannot be demonstrated against a primary or highly authoritative source.
- Buyer is clearly enterprise-only with vendor/security/procurement review.
- Product is merely a primary-source database and does not generate claims customers rely on.
- The only issue is a disclaimer that already accurately cabins the output.

## Outbound rule

Never open with “AI hallucination” or a feature list. Lead with one exact claim and one exact source. Do not dump all findings for free.

Template:

I tested one public answer in your product and found a claim where the current primary authority appears to contradict the result.

Claim: [exact claim]
Primary source: [source]
Issue: [one sentence]

I run adversarial Fact Audits for teams shipping AI-generated answers: up to 25 outputs reviewed, findings ranked by consequence, evidence attached, fixes recommended, and the highest-risk claims monitored for seven days.

I can send the proof page for this finding first if useful.

## Immediate sequence

1. Finish the Ask Sawyer customer-facing proof page.
2. Stress-test LegalMind and Draft Ally with controlled contracts.
3. Stress-test Rasind/Pinpoint on source-entailment and superseded-authority cases.
4. Test Atorni only after an account surface is available.
5. Move to healthcare public demos after legal lane yields at least two outbound-ready packets.
6. Do not spend engineering time on API/provider economics until audit delivery requires it.
