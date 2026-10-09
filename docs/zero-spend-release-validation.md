# ProofTTL zero-spend release validation

Purpose: validate the customer audit lifecycle and paid-verification boundaries without buying ProofTTL, initiating a live card charge, funding a wallet, or submitting a real customer order.

## Guardrails

- Do not open or submit the production Stripe checkout link as a test.
- Do not use live Stripe API keys, a real payment method, or a production x402 wallet.
- Do not run `npm run test:payment`, `npm run test:payment:semantic`, `npm run audit:run:testnet`, or any testnet payer command unless a funded test wallet is intentionally available and the operator approves that test. Those are not part of the zero-spend gate.
- The automated Stripe lifecycle tests stub network requests and use fixture credentials. They prove application behavior under simulated Stripe responses, not that Stripe's live payment rails or production webhook delivery have been exercised.
- Never claim that a simulated webhook proves a real email was delivered. A test inbox or email-capture service is required to prove message generation/delivery behavior.

## One-command local gate

From the repository root, with Node.js and dependencies installed:

```bash
npm ci
npm run test:zero-spend
```

The command runs the existing deterministic tests for:

1. Intake validation, rate limits, and fail-closed storage behavior.
2. Scope-before-payment, exact pricing, human approval, fulfillment, and seven-day watch rules.
3. Stripe checkout/webhook lifecycle using mocked fetch calls, including duplicate events, mismatched amounts/currencies, idempotency, retries, and checkout recovery.
4. x402 payment-gate behavior, including HTTP 402 on failed verification/settlement and ensuring protected handlers do not run before successful settlement.
5. The monitor attempt-cap regression.

These tests should not require Stripe credentials or a funded wallet. If any selected test unexpectedly attempts a network payment, stop and fix the test harness rather than funding it.

The pull-request workflow `.github/workflows/zero-spend-provider-validation.yml` runs this deterministic gate automatically. Its separate manual provider checks are opt-in and are never run on pull requests.

## Customer journey: what is and is not proven

| Stage | Zero-cost proof available | Limitation |
|---|---|---|
| Fact Audit intake | Local test asserts validation and stored fixture state | Does not prove production mail delivery |
| Scope and price | Local test asserts the fixed $1,500 scope and no payment request before scope confirmation | Does not prove production admin access/configuration |
| Checkout creation | Mocked Stripe API response and exact 150000-cent amount assertion | Does not prove live Stripe configuration |
| Webhook | Locally signed fixture webhook; duplicate and invalid amount/currency cases | Does not prove Stripe can reach the deployed webhook |
| Approval and fulfillment | Local lifecycle fixture verifies human approval, report digest, and seven-day watch | Does not prove real report hosting or customer notification |
| Rapid Claim Check ($299) | Public pricing and checkout destination can be inspected without submitting checkout | Post-payment email intake is a separate workflow; do not describe it as automated fulfillment unless verified |
| MCP Fact Lease | Public fixed Example Domain round-trip is available without paid arbitrary verification | Only tests the bounded fixture; it does not validate paid arbitrary claims |
| Paid MCP verification | Assert that unpaid/failed payment returns 402 and protected work is not run | A real settlement test requires testnet funds or a separately authorized funded test |
| Production payment | Wait for a real customer transaction or an explicitly funded, authorized test | Cannot be fully proven without a live payment event |

## Manual no-spend checks

1. Open the homepage, `/audit/`, `/services/`, and `/trust/`; confirm the published offers are $299 Rapid Claim Check and $1,500 Fact Audit.
2. Inspect the $299 Stripe checkout destination without entering payment information or clicking the final purchase action. Confirm the displayed product and amount; this is only a presentation check.
3. Query the public service status and capability registry. Confirm the service is healthy and arbitrary claim verification remains payment-protected.
4. Invoke the bounded Fact Lease fixture only. Confirm creation/retrieval uses the same lease ID and identifies itself as a test fixture.
5. Save the CI run URL and its job results as evidence. Report any production mail or live payment checks as **not yet verified** unless an actual delivery/settlement record exists.

## Live verification performed for this runbook

- Live status returned `ok: true`, service `proofttl`, version `1.0.1`, protocol `ProofTTL/0.3.1`, with storage, AI, and automatic monitoring enabled.
- The bounded public Fact Lease round-trip returned `ok: true`; creation and retrieval succeeded, lease IDs matched, and the fixed `Example Domain` claim was `SUPPORTED` from exact-text evidence. The response marked it as a test fixture.
- No live Stripe purchase, payment, wallet funding, or customer email was initiated for these checks.

## Evidence standard

Mark each item as **PASS**, **FAIL**, or **NOT VERIFIED**. Keep fixture-based and production evidence separate. A successful local test suite is evidence of application logic, not proof that third-party production configuration, webhook delivery, email delivery, or real settlement works.


## Optional provider checks (manual dispatch only)

Open GitHub Actions → **ProofTTL Zero-Spend Provider Validation** → **Run workflow**.

- Leave both provider toggles off for the default fixture-only validation.
- For the Stripe check, add a GitHub Actions repository secret named `STRIPE_TEST_SECRET_KEY` containing a key beginning `sk_test_`, then enable **Run a read-only Stripe test-key check**. It calls only `GET /v1/account`; it creates no Checkout Session, PaymentIntent, or charge. A live-key prefix is rejected before any request.
- For the Resend check, add a GitHub Actions repository secret named `RESEND_TEST_API_KEY` with a sending-only Resend key, then enable **Send one synthetic email to Resend's delivery-simulation sink only**. The script hard-codes `onboarding@resend.dev` as sender and `delivered@resend.dev` as recipient, includes no customer data, and uses a daily idempotency key. It cannot target a buyer address.
- Resend currently has no verified sending domain or API key configured for this project. The sink-only check will remain skipped in normal CI and will fail clearly if manually requested without its test key. Resend documents `delivered@resend.dev` as a simulated-delivery recipient; this does not verify a real sender domain or inbox delivery.
- No provider secret belongs in source control. Never put a secret in a workflow file, commit, test fixture, command-line argument, or CI log.

Provider checks are intentionally outside `test:zero-spend` because they require optional external credentials and the Resend sink check sends one simulated test message. The default pull-request job remains deterministic and does not call either provider.
