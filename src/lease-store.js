import {
  listDueLeaseIds,
  markMissingLeaseInactive,
  reconcileMonitorScheduleBatch,
  upsertMonitorSchedule
} from "./monitor-schedule.js";
import { buildClaimContract } from "./claim-contract.js";
import { deriveTtlPolicy } from "./ttl-policy.js";
import {
  attachLeaseIssuanceSignature,
  attachLeaseVerificationContextSignature
} from "./lease-signing.js";
import { attachLeaseEventSignatures } from "./event-signing.js";

const LEASE_PREFIX = "lease:";
const FALLBACK_LIST_EVERY_MINUTES = 2;
const RECONCILE_EVERY_MINUTES = 5;
const HEX_SHARDS = "0123456789abcdef";

export function createLeaseStoreBinding(kv, db, options = {}) {
  if (!kv) return kv;
  const monitorNow = Number.isFinite(options.monitorNow) ? options.monitorNow : null;
  const signingPrivateJwk = options.signingPrivateJwk || null;
  const signingKeyId = options.signingKeyId || undefined;

  return {
    async get(key, ...args) {
      const value = await kv.get(key, ...args);
      if (value === null && db && typeof key === "string" && key.startsWith(LEASE_PREFIX)) {
        const leaseId = key.slice(LEASE_PREFIX.length);
        try {
          await markMissingLeaseInactive(db, leaseId, monitorNow ?? Date.now());
        } catch (error) {
          console.error(JSON.stringify({
            event: "monitor_schedule_missing_lease_mark_failed",
            lease_id: leaseId,
            error: error?.message || String(error)
          }));
        }
      }
      return value;
    },

    async put(key, value, putOptions = {}) {
      const isLease = typeof key === "string" && key.startsWith(LEASE_PREFIX);
      if (!isLease) {
        return kv.put(key, value, putOptions);
      }

      let lease = null;
      let storedValue = value;
      try {
        lease = typeof value === "string" ? JSON.parse(value) : value;
      } catch (error) {
        console.error(JSON.stringify({
          event: "lease_store_parse_failed",
          lease_key: key,
          error: error?.message || String(error)
        }));
      }

      if (lease && typeof lease === "object") {
        attachImmutableVerificationContext(lease);
        storedValue = JSON.stringify(lease);
      }

      if (lease && typeof lease === "object" && signingPrivateJwk) {
        try {
          if (!lease.signature) {
            await attachLeaseIssuanceSignature(lease, signingPrivateJwk, signingKeyId);
          }
          if (!lease.verification_context_signature && lease.claim_contract && lease.ttl_policy) {
            await attachLeaseVerificationContextSignature(lease, signingPrivateJwk, signingKeyId);
          }
          await attachLeaseEventSignatures(lease, signingPrivateJwk, signingKeyId);
          storedValue = JSON.stringify(lease);
        } catch (error) {
          // Signing stays additive during rollout. A crypto/configuration problem
          // must not turn a correctly settled verification into a charged 500.
          console.error(JSON.stringify({
            event: "lease_signing_failed",
            lease_id: lease?.lease_id || null,
            error: error?.message || String(error)
          }));
        }
      }

      await kv.put(key, storedValue, putOptions);

      if (!db || !lease || typeof lease !== "object") return;
      try {
        await upsertMonitorSchedule(db, lease, Date.now());
      } catch (error) {
        // KV is the source of truth. A scheduler-index failure must not turn a
        // successfully persisted paid lease into a charged 500 response.
        // Periodic reconciliation repairs the D1 index from KV metadata.
        console.error(JSON.stringify({
          event: "monitor_schedule_upsert_failed",
          lease_key: key,
          error: error?.message || String(error)
        }));
      }
    },

    async list(options = {}) {
      const prefix = options?.prefix || "";
      if (prefix !== LEASE_PREFIX || monitorNow === null) {
        return kv.list(options);
      }

      if (db) {
        try {
          const ids = await listDueLeaseIds(db, monitorNow, options?.limit || 10);
          return {
            keys: ids.map((id) => ({ name: `${LEASE_PREFIX}${id}`, metadata: null })),
            list_complete: true,
            cacheStatus: null
          };
        } catch (error) {
          console.error(JSON.stringify({
            event: "monitor_schedule_query_failed",
            error: error?.message || String(error)
          }));
          // Fall through to the bounded KV compatibility path.
        }
      }

      return fallbackMonitorList(kv, options, monitorNow);
    }
  };
}

export async function reconcileMonitorScheduleFromKv(env, scheduledTime = Date.now()) {
  if (!env?.LEASES || !env?.MONITOR_DB) return { attempted: false, reconciled: 0 };

  const now = Number.isFinite(scheduledTime) ? scheduledTime : Date.now();
  const scheduledMinute = Math.floor(now / 60000);
  if (scheduledMinute % RECONCILE_EVERY_MINUTES !== 0) {
    return { attempted: false, reconciled: 0 };
  }

  const shardIndex = Math.floor(scheduledMinute / RECONCILE_EVERY_MINUTES) % HEX_SHARDS.length;
  const shard = HEX_SHARDS[shardIndex];
  const prefix = `${LEASE_PREFIX}ftl_${shard}`;

  try {
    const listed = await env.LEASES.list({ prefix, limit: 1000 });
    const reconciled = await reconcileMonitorScheduleBatch(
      env.MONITOR_DB,
      listed.keys || [],
      now
    );
    console.log(JSON.stringify({
      event: "monitor_schedule_reconciled",
      shard,
      keys_seen: listed.keys?.length || 0,
      reconciled
    }));
    return { attempted: true, shard, reconciled };
  } catch (error) {
    console.error(JSON.stringify({
      event: "monitor_schedule_reconcile_failed",
      shard,
      error: error?.message || String(error)
    }));
    return { attempted: true, shard, reconciled: 0, error: true };
  }
}

function attachImmutableVerificationContext(lease) {
  if (!lease?.lease_id || !lease?.claim || !lease?.issued_at || !lease?.source_fingerprint) return lease;

  if (!lease.claim_contract) {
    try {
      lease.claim_contract = buildClaimContract(lease.claim, {
        nowMs: Date.parse(lease.issued_at || lease.observed_at)
      });
    } catch (error) {
      console.error(JSON.stringify({
        event: "lease_claim_contract_build_failed",
        lease_id: lease.lease_id,
        error: error?.message || String(error)
      }));
    }
  }

  if (!lease.ttl_policy && lease.claim_contract) {
    try {
      const recommendation = deriveTtlPolicy({
        claimContract: lease.claim_contract,
        confidence: Number.isFinite(Number(lease.confidence)) ? Number(lease.confidence) : null,
        contradictionCount: 0,
        sourceCount: 1,
        requestedTtlSeconds: null
      });
      const effectiveTtl = Number(lease.ttl_seconds);
      lease.ttl_policy = {
        ...recommendation,
        mode: "ADVISORY_V1",
        effective_ttl_seconds: Number.isFinite(effectiveTtl) ? effectiveTtl : null,
        applied_to_lease: false,
        effective_within_recommendation: Number.isFinite(effectiveTtl)
          ? effectiveTtl <= recommendation.ttl_seconds
          : null
      };
    } catch (error) {
      console.error(JSON.stringify({
        event: "lease_ttl_policy_build_failed",
        lease_id: lease.lease_id,
        error: error?.message || String(error)
      }));
    }
  }

  return lease;
}

async function fallbackMonitorList(kv, options, monitorNow) {
  const scheduledMinute = Math.floor(monitorNow / 60000);
  if (scheduledMinute % FALLBACK_LIST_EVERY_MINUTES !== 0) {
    return { keys: [], list_complete: true, cacheStatus: null };
  }

  // Compatibility mode before D1 is bound: one global KV list every two
  // minutes. This stays below the Free KV list-request allowance at idle.
  // It is intentionally temporary; D1 is the scalable scheduler.
  return kv.list({ ...options, prefix: LEASE_PREFIX, limit: Math.min(options?.limit || 1000, 1000) });
}
