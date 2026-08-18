# ProofTTL monitoring scheduler

ProofTTL keeps full Fact Lease payloads in Workers KV and uses D1 only as a small due-time index for automatic monitoring.

## Why

The original minute cron listed `lease:` keys from KV every run. That creates a fixed list-request cost at idle and can starve leases beyond the first 1,000 listed keys.

The current architecture keeps KV as the source of truth while indexing these fields in D1:

- `lease_id`
- `lease_state`
- `next_check_at_ms`
- `expires_at_ms`
- `updated_at_ms`

A scheduled run asks D1 for the next due leases, then loads only those lease payloads from KV.

## One-time free D1 setup

From the ProofTTL repository on a machine already authenticated with Cloudflare:

```powershell
npm run monitor:d1:create
```

This runs Wrangler with:

```text
wrangler d1 create proofttl-monitor --binding MONITOR_DB --update-config
```

It creates the D1 database and adds its generated `database_id` to `wrangler.jsonc` under the `MONITOR_DB` binding.

Then apply the checked-in scheduler migration:

```powershell
npm run monitor:d1:migrate
```

This applies `migrations/0001_monitor_schedule.sql` to the remote D1 database.

Before deployment run:

```powershell
npm run test:all
```

Then deploy normally:

```powershell
npm run deploy
```

## Failure behavior

KV remains authoritative.

- A Fact Lease is written to KV before the D1 schedule index is updated.
- If the D1 upsert fails, the paid lease remains valid and the request is not converted into a charged 500 solely because the index failed.
- Structured telemetry records scheduler failures.
- A five-minute sharded reconciliation pass repairs the D1 index from KV metadata.
- Missing KV payloads are marked `MISSING` in D1 so they do not remain permanently due.

## Compatibility mode before D1 is attached

Until `MONITOR_DB` exists, the storage adapter permits the existing monitor to list KV only every two scheduled minutes. That caps idle KV list calls at 720/day instead of 1,440/day.

Compatibility mode is for migration only. D1 is the scalable monitor scheduler.
