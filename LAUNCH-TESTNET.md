# ProofTTL guarded testnet launch

This repository now has a Windows-first launch path that turns the remaining Cloudflare account-side setup into one guarded command.

## One command

From the ProofTTL backend repository root in PowerShell:

```powershell
npm run launch:testnet
```

The launcher is intentionally testnet-only. It does not enable Base mainnet or change the x402 receiver/payment terms.

## What the launcher does

1. Verifies Wrangler is installed and the operator is authenticated to Cloudflare.
2. Runs the complete local ProofTTL regression/safety suite.
3. Reads `wrangler.jsonc` and creates `proofttl-monitor` only when the `MONITOR_DB` binding is absent.
4. Applies the remote D1 migrations.
5. Generates an Ed25519 signing keypair only when no signing key files exist.
6. Uploads the private JWK with `wrangler secret put` through stdin so the script never prints the private key.
7. Runs a Wrangler deployment dry run.
8. Runs `npm run deploy`.
   - `predeploy` executes local tests.
   - Wrangler deploys the Worker.
   - `postdeploy` executes the live smoke test.
9. Verifies the live public signing-key endpoint reports signing enabled.
10. Verifies the automatic monitor status endpoint reports enabled.

## Live smoke coverage

The post-deploy smoke test does **not** authorize a payment and does **not** invoke voice AI inference.

It checks:

- `/health`
- ProofTTL discovery metadata
- assistant discovery metadata
- OpenAPI metadata
- browser preflight for `/verify`
- browser preflight for `/assistant/voice`
- x402 `PAYMENT-SIGNATURE` request-header allowance
- HTTP 402 `PAYMENT-REQUIRED` challenge
- browser exposure of `PAYMENT-REQUIRED` and `PAYMENT-RESPONSE`
- Base Sepolia network and receiver metadata
- manual reverify remains disabled

## Signing-key safeguards

The private file is:

```text
.proofttl-signing-private.jwk
```

It is secret and must remain gitignored.

The launcher will **not** overwrite an existing private key. If it finds only a public key with no matching private key, it stops instead of silently generating a mismatched pair.

## D1 safeguard

The launcher searches `wrangler.jsonc` for the exact `MONITOR_DB` binding before creating a database. If the binding already exists, it reuses it and only applies migrations.

When Wrangler creates D1 with `--update-config`, `wrangler.jsonc` is modified locally with the real database ID. Commit that config change after the launch succeeds so future deploys continue using the same D1 database.

## Deployment lifecycle

`package.json` deliberately separates local and live checks:

```text
test:local   -> deterministic/local code checks only
predeploy    -> test:local
deploy       -> wrangler deploy
postdeploy   -> test:smoke
test:all     -> test:local + live smoke
```

This avoids the old circular failure mode where a live smoke test for new endpoints could block the deployment required to make those endpoints live.

## If the deploy command fails

A failure before Wrangler deploy means the existing Worker remains unchanged.

A failure in `postdeploy` means Wrangler deployed a Worker but the public contract did not pass verification. Read the failing smoke assertion before making additional changes.

Useful commands:

```powershell
npm run test:local
npm run test:smoke
npm run tail
```

Wrangler also supports version listing and rollback if an already-deployed Worker needs to be reverted.

## What is still intentionally not enabled

- Base mainnet payments
- production customer authentication
- account-scoped billing/usage history
- private operator/admin console

Those are separate product milestones and are not silently enabled by this launch script.
