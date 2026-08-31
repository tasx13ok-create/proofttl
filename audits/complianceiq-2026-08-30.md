# ProofTTL Fact Audit — ComplianceIQ

Audit date: 2026-08-30
Target: https://trycomplianceiq.com/
Target checklist: https://trycomplianceiq.com/checklist/eu-ai-act
Status: OUTREACH-READY

## Executive read

ComplianceIQ markets itself as a continuously current AI-compliance product for SMBs, promising to identify exactly which laws apply, generate required compliance materials, and track deadlines. Its public EU AI Act checklist and homepage contain multiple high-confidence timing and classification errors when compared with the current consolidated EU AI Act as amended through 27 July 2026.

The cleanest outbound finding is the checklist's August 2, 2026 deadline for high-risk AI conformity/oversight obligations. The current Article 113 phases those obligations to 2 December 2027 for Annex III systems and 2 August 2028 for Annex I product systems.

## Finding 1 — High-risk AI obligations shown due August 2, 2026 after the law moved them to 2027/2028

Severity: HIGH
Verdict: CONTRADICTED / STALE DEADLINE
Confidence: HIGH

### Published claim

ComplianceIQ's public EU Artificial Intelligence Act Compliance Checklist 2026 states:
- "Human Oversight Procedures" — Due: August 2, 2026.
- "For high-risk AI: complete a conformity assessment before deployment."
- The checklist labels enforcement generally as August 2, 2026 and presents these high-risk obligations as part of the same immediate compliance deadline.

Homepage FAQ goes further: "The August 2, 2026 deadline is when enforcement begins for high-risk AI obligations."

### Primary-source evidence

Current consolidated Regulation (EU) 2024/1689, Article 113, as of 27 July 2026:
https://eur-lex.europa.eu/eli/reg/2024/1689/2026-07-27/eng

Article 113(c) states that Chapter III Sections 1, 2 and 3 — the high-risk classification, requirements and provider/deployer obligations — apply from:
- 2 December 2027 for systems classified high-risk under Article 6(2) / Annex III; and
- 2 August 2028 for systems classified high-risk under Article 6(1) / Annex I.

European Commission implementation guidance likewise says high-risk systems become subject to the strict obligations starting 2 December 2027:
https://digital-strategy.ec.europa.eu/en/policies/regulatory-framework-ai

### Why the claim fails

August 2, 2026 is no longer the operative deadline for the principal Annex III high-risk obligations listed in the ComplianceIQ checklist. The current law explicitly phases them later. A compliance product that generates roadmaps and deadline alerts should not tell SMBs that these high-risk obligations became enforceable on August 2, 2026.

### User consequence

Customers may treat future-dated obligations as already overdue, mis-prioritize compliance spend, generate unnecessary documentation, or receive incorrect "non-compliant" risk scores.

### Repair

Split the EU AI Act timeline by obligation. Keep Article 50 transparency obligations at 2 August 2026 where applicable, but move Annex III high-risk Chapter III Sections 1–3 obligations to 2 December 2027 and Annex I high-risk product obligations to 2 August 2028.

---

## Finding 2 — "Customer data" is presented as a high-risk classification trigger

Severity: HIGH
Verdict: CLASSIFICATION ERROR
Confidence: HIGH

### Published claim

Homepage "Are you exposed?" block says:

"Does your AI tool process customer data? — High-risk classification"

### Primary-source evidence

Current Article 6 and Annex III of Regulation (EU) 2024/1689:
https://eur-lex.europa.eu/eli/reg/2024/1689/2026-07-27/eng

Article 6 classifies high-risk systems based on product-safety conditions under Annex I and specified use cases in Annex III. Annex III covers defined contexts such as biometrics, critical infrastructure, education, employment, essential services/credit scoring, law enforcement, migration and justice. Merely processing customer data is not a standalone high-risk trigger.

Article 6(3) also provides that some Annex III systems are not high-risk where they do not pose a significant risk and meet specified conditions, except profiling cases.

### Why the claim fails

The presence of customer data is not equivalent to a high-risk classification under the AI Act. Data type can matter to risk analysis, but the legal classification depends on the system's intended purpose and whether it falls into the specified Article 6 / Annex I / Annex III framework.

### User consequence

A small business could be incorrectly told an ordinary AI tool is high-risk solely because it touches customer data, materially changing its perceived compliance burden.

### Repair

Replace the binary "customer data = high-risk" rule with an intended-purpose/use-case classification path keyed to Article 6 and Annexes I/III.

---

## Finding 3 — EU AI Act scope is overstated as covering any business whose AI touches EU-resident data

Severity: MEDIUM-HIGH
Verdict: SCOPE OVERSTATEMENT
Confidence: HIGH

### Published claim

Homepage states:

"The EU AI Act covers any business that uses AI to process data about EU residents — even if you've never set foot in Europe. If you use ChatGPT for customer emails, AI for hiring, or any AI tool that touches EU customer data, you have obligations."

It also presents "Do you have EU customers or website visitors? — EU AI Act applies."

### Primary-source evidence

Article 2 of the current consolidated AI Act sets scope in terms of providers placing AI systems/models on the EU market, deployers established/located in the Union, and third-country providers/deployers where the AI system's output is used in the Union, along with specified operator categories.

Primary source:
https://eur-lex.europa.eu/eli/reg/2024/1689/2026-07-27/eng

### Why the claim needs correction

Article 2 does not establish a general "AI processes data about an EU resident" jurisdictional test. That framing resembles GDPR concepts and can wrongly imply that any website visitor or any EU customer automatically makes every AI use subject to the AI Act.

### User consequence

Businesses can be falsely placed in-scope and sold compliance work based on an overbroad jurisdictional rule.

### Repair

Use the actual Article 2 operator/output tests and separately evaluate GDPR/privacy obligations where personal-data processing is the relevant trigger.

---

## Why this target is commercially qualified

ComplianceIQ's core promise is accuracy and currency: it says it tracks 155+ jurisdictions, identifies exactly which laws apply, alerts customers as deadlines approach, and generates documents based on current regulatory requirements. These findings therefore hit its central paid value proposition, not incidental content.

The public site also offers $199/month and $349/month plans, suggesting a founder/SMB-stage product with a relatively short sales path compared with enterprise GRC vendors.

## Outreach lead

Lead with Finding 1 only. It is objective, current, easy to verify against Article 113, and directly relevant to deadline tracking.

Suggested proof-page headline:

> ComplianceIQ tells customers high-risk EU AI obligations were due August 2, 2026. The current AI Act moved the core Annex III obligations to December 2, 2027.

Hold Findings 2 and 3 in reserve to demonstrate that the issue is not a single stale date.

## Evidence discipline

- Preserve a dated capture of the homepage and checklist before outreach.
- Cite the 27 July 2026 consolidated EUR-Lex text, not the original 2024 schedule.
- Do not claim "the EU AI Act does not enforce anything in 2026"; Article 50 transparency obligations and other provisions do apply from 2 August 2026.
- Frame Finding 3 as an overbroad scope rule, not a categorical claim that non-EU businesses are exempt.
