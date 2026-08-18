const DEFAULT_FREE_DAILY_MESSAGES = 20;

export function assistantQuotaLimit(env) {
  const parsed = Number(env?.PROOFTTL_ASSISTANT_FREE_DAILY_MESSAGES);
  return Number.isInteger(parsed) && parsed > 0
    ? parsed
    : DEFAULT_FREE_DAILY_MESSAGES;
}

export async function getAssistantQuota(request, env) {
  const limit = assistantQuotaLimit(env);
  const timing = quotaTiming();
  const subjectHash = await quotaSubjectHash(request, env);

  if (env?.MONITOR_DB && typeof env.MONITOR_DB.prepare === "function") {
    try {
      const row = await env.MONITOR_DB
        .prepare(
          "SELECT used_messages FROM assistant_usage_daily WHERE subject_hash = ?1 AND usage_day = ?2 LIMIT 1"
        )
        .bind(subjectHash, timing.day)
        .first();
      const used = Math.max(0, Number(row?.used_messages) || 0);
      return quotaShape(limit, used, timing.retryAfterSeconds, "d1");
    } catch (error) {
      console.warn(JSON.stringify({
        event: "assistant_quota_status_d1_failed",
        error: safeErrorName(error)
      }));
    }
  }

  return getKvQuota(subjectHash, timing, env, limit);
}

export async function consumeAssistantQuota(request, env) {
  const limit = assistantQuotaLimit(env);
  const timing = quotaTiming();
  const subjectHash = await quotaSubjectHash(request, env);

  if (env?.MONITOR_DB && typeof env.MONITOR_DB.prepare === "function") {
    try {
      const row = await env.MONITOR_DB
        .prepare(
          `INSERT INTO assistant_usage_daily (subject_hash, usage_day, used_messages, updated_at_ms)
           VALUES (?1, ?2, 1, ?3)
           ON CONFLICT(subject_hash, usage_day) DO UPDATE SET
             used_messages = used_messages + 1,
             updated_at_ms = excluded.updated_at_ms
           WHERE used_messages < ?4
           RETURNING used_messages`
        )
        .bind(subjectHash, timing.day, Date.now(), limit)
        .first();

      if (!row) {
        return {
          ...quotaShape(limit, limit, timing.retryAfterSeconds, "d1"),
          allowed: false
        };
      }

      const used = Math.max(0, Number(row.used_messages) || 0);
      return {
        ...quotaShape(limit, used, timing.retryAfterSeconds, "d1"),
        allowed: used <= limit
      };
    } catch (error) {
      console.warn(JSON.stringify({
        event: "assistant_quota_consume_d1_failed",
        error: safeErrorName(error)
      }));
    }
  }

  return consumeKvQuota(subjectHash, timing, env, limit);
}

function quotaShape(limit, used, retryAfterSeconds, backend) {
  return {
    allowed: used < limit,
    plan: "free",
    limit,
    used: Math.min(limit, used),
    remaining: Math.max(0, limit - used),
    reset: "daily_utc",
    retry_after_seconds: retryAfterSeconds,
    accounting_backend: backend
  };
}

function quotaTiming() {
  const now = new Date();
  const tomorrow = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate() + 1
  );
  return {
    day: now.toISOString().slice(0, 10),
    retryAfterSeconds: Math.max(1, Math.ceil((tomorrow - Date.now()) / 1000))
  };
}

async function quotaSubjectHash(request, env) {
  const ip = (request.headers.get("cf-connecting-ip") || "anonymous")
    .trim()
    .slice(0, 120);
  const secret = String(
    env?.PROOFTTL_USAGE_HASH_SECRET ||
    env?.BETTER_AUTH_SECRET ||
    "proofttl-anonymous-quota-v1"
  );
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const digest = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(`anonymous:${ip}`)
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function getKvQuota(subjectHash, timing, env, limit) {
  if (!env?.LEASES || typeof env.LEASES.get !== "function") {
    return {
      allowed: true,
      plan: "free",
      limit,
      used: null,
      remaining: null,
      reset: "daily_utc",
      retry_after_seconds: timing.retryAfterSeconds,
      accounting_backend: "rate_limit_only"
    };
  }

  const used = Number(
    await env.LEASES.get(`assistant-free:${timing.day}:${subjectHash}`)
  ) || 0;
  return quotaShape(limit, used, timing.retryAfterSeconds, "kv_fallback");
}

async function consumeKvQuota(subjectHash, timing, env, limit) {
  if (
    !env?.LEASES ||
    typeof env.LEASES.get !== "function" ||
    typeof env.LEASES.put !== "function"
  ) {
    return {
      allowed: true,
      plan: "free",
      limit,
      used: null,
      remaining: null,
      reset: "daily_utc",
      retry_after_seconds: timing.retryAfterSeconds,
      accounting_backend: "rate_limit_only"
    };
  }

  const key = `assistant-free:${timing.day}:${subjectHash}`;
  const previous = Number(await env.LEASES.get(key)) || 0;
  if (previous >= limit) {
    return {
      ...quotaShape(limit, limit, timing.retryAfterSeconds, "kv_fallback"),
      allowed: false
    };
  }

  const used = previous + 1;
  await env.LEASES.put(key, String(used), {
    expirationTtl: timing.retryAfterSeconds + 300
  });
  return {
    ...quotaShape(limit, used, timing.retryAfterSeconds, "kv_fallback"),
    allowed: true
  };
}

function safeErrorName(error) {
  return error?.name || error?.constructor?.name || "Error";
}
