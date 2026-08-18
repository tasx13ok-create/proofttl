import { getOptionalProofTTLSession } from "./auth.js";

const DEFAULT_MEMBER_DAILY_MESSAGES = 200;

export async function resolveAssistantEntitlement(request, env, freeLimit) {
  const session = await getOptionalProofTTLSession(request, env);
  const userId = session?.user?.id || session?.session?.userId || null;

  if (!userId) {
    return {
      authenticated: false,
      subject: null,
      plan: "free",
      membership_status: "anonymous",
      limit: freeLimit,
      source: "anonymous"
    };
  }

  return resolveStoredAssistantEntitlement(String(userId), env, freeLimit);
}

export async function resolveStoredAssistantEntitlement(userId, env, freeLimit) {
  const normalizedUserId = String(userId || "").trim();
  if (!normalizedUserId) {
    return {
      authenticated: false,
      subject: null,
      plan: "free",
      membership_status: "anonymous",
      limit: freeLimit,
      source: "anonymous"
    };
  }

  const fallback = {
    authenticated: true,
    subject: `user:${normalizedUserId}`,
    plan: "free",
    membership_status: "inactive",
    limit: freeLimit,
    source: "default"
  };

  if (!env?.MONITOR_DB || typeof env.MONITOR_DB.prepare !== "function") {
    return fallback;
  }

  try {
    const row = await env.MONITOR_DB
      .prepare(
        `SELECT plan, membership_status, assistant_daily_limit, period_end_ms, source
         FROM account_entitlement
         WHERE user_id = ?1
         LIMIT 1`
      )
      .bind(normalizedUserId)
      .first();

    if (!row) return fallback;

    const now = Date.now();
    const periodEnd = Number(row.period_end_ms) || null;
    const active = row.membership_status === "active" && (!periodEnd || periodEnd > now);
    const requestedPlan = String(row.plan || "free");
    const member = active && requestedPlan === "member";
    const configuredMemberLimit = positiveInt(
      env.PROOFTTL_MEMBER_ASSISTANT_DAILY_MESSAGES,
      DEFAULT_MEMBER_DAILY_MESSAGES
    );
    const storedLimit = positiveInt(row.assistant_daily_limit, configuredMemberLimit);

    return {
      authenticated: true,
      subject: `user:${normalizedUserId}`,
      plan: member ? "member" : "free",
      membership_status: member ? "active" : String(row.membership_status || "inactive"),
      limit: member ? storedLimit : freeLimit,
      period_end_ms: periodEnd,
      source: String(row.source || "system")
    };
  } catch (error) {
    console.warn(JSON.stringify({
      event: "assistant_entitlement_lookup_failed",
      error: error?.name || error?.constructor?.name || "Error"
    }));
    return fallback;
  }
}

function positiveInt(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}
