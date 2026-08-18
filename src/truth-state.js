const MIN_HALF_LIFE_SECONDS = 60;
const MAX_HALF_LIFE_SECONDS = 30 * 24 * 60 * 60;

export function computeTruthState(lease, nowMs = Date.now()) {
  if (!lease || typeof lease !== "object") throw new TypeError("lease_required");

  const history = Array.isArray(lease.history) ? lease.history : [];
  const issuedAtMs = parseTime(lease.issued_at, nowMs);
  const expiresAtMs = parseTime(lease.expires_at, issuedAtMs + 3600_000);
  const ageMs = Math.max(0, nowMs - issuedAtMs);
  const lifetimeMs = Math.max(1, expiresAtMs - issuedAtMs);
  const freshnessRatio = clamp01(1 - ageMs / lifetimeMs);

  let sourceChangeCount = 0;
  let statusChangeCount = 0;
  let previousStatus = typeof lease.status === "string" ? lease.status : null;

  for (const check of history) {
    const result = String(check?.result || "");
    if (result === "SOURCE_CHANGED_STILL_CONSISTENT" || result === "REVOKED" || result === "EXPIRED_AND_VERDICT_CHANGED") {
      sourceChangeCount += 1;
    }
    if (previousStatus && typeof check?.status === "string" && check.status !== previousStatus) {
      statusChangeCount += 1;
    }
    if (typeof check?.status === "string") previousStatus = check.status;
  }

  const observedChecks = Math.max(1, history.length);
  const changeRate = clamp01(sourceChangeCount / observedChecks);
  const statusChangeRate = clamp01(statusChangeCount / observedChecks);
  const confidence = clamp01(Number(lease.confidence) || 0);
  const leaseState = String(lease.lease_state || "ACTIVE").toUpperCase();
  const verdict = String(lease.status || "UNKNOWN").toUpperCase();

  const statePenalty = leaseState === "ACTIVE" ? 0 : leaseState === "EXPIRED" ? 0.35 : 0.65;
  const verdictPenalty = verdict === "SUPPORTED" ? 0 : verdict === "CONTRADICTED" ? 0.55 : 0.3;
  const volatilityScore = clamp01(
    0.08 +
    changeRate * 0.5 +
    statusChangeRate * 0.25 +
    (1 - freshnessRatio) * 0.12 +
    statePenalty * 0.25
  );

  const stabilityScore = clamp01(
    confidence * 0.48 +
    freshnessRatio * 0.27 +
    (1 - volatilityScore) * 0.25 -
    verdictPenalty -
    statePenalty
  );

  const truthTemperature = round2(clamp01(
    volatilityScore * 0.68 +
    (1 - freshnessRatio) * 0.2 +
    verdictPenalty * 0.12
  ) * 100);

  const evidenceGravity = round2(clamp01(
    confidence * 0.55 +
    freshnessRatio * 0.25 +
    (1 - volatilityScore) * 0.2
  ) * 100);

  const baseHalfLife = Math.max(
    Number(lease.monitor_interval_seconds) || 0,
    Number(lease.ttl_seconds) || Math.round(lifetimeMs / 1000)
  );
  const evidenceHalfLifeSeconds = Math.round(clamp(
    baseHalfLife * (1.4 - volatilityScore) * (0.65 + confidence * 0.7),
    MIN_HALF_LIFE_SECONDS,
    MAX_HALF_LIFE_SECONDS
  ));

  const visualState = classifyVisualState({ leaseState, verdict, freshnessRatio, stabilityScore, truthTemperature });
  const failureConditions = inferFailureConditions(lease);

  return {
    lease_id: lease.lease_id || null,
    visual_state: visualState,
    stability_score: round4(stabilityScore),
    volatility_score: round4(volatilityScore),
    truth_temperature: truthTemperature,
    evidence_gravity: evidenceGravity,
    evidence_half_life_seconds: evidenceHalfLifeSeconds,
    freshness_ratio: round4(freshnessRatio),
    source_change_count: sourceChangeCount,
    status_change_count: statusChangeCount,
    failure_conditions: failureConditions,
    proof_shadows: normalizeDependencies(lease.depends_on),
    love: visualEnvelope(visualState, truthTemperature, evidenceGravity, volatilityScore),
    computed_at: new Date(nowMs).toISOString()
  };
}

export async function persistTruthState(db, lease, nowMs = Date.now()) {
  if (!db?.prepare || !lease?.lease_id) return null;
  const state = computeTruthState(lease, nowMs);

  await db.prepare(
    `INSERT INTO truth_state (
      lease_id, visual_state, stability_score, volatility_score, truth_temperature,
      evidence_gravity, evidence_half_life_seconds, freshness_ratio,
      source_change_count, status_change_count, failure_conditions_json, computed_at_ms
    ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)
    ON CONFLICT(lease_id) DO UPDATE SET
      visual_state = excluded.visual_state,
      stability_score = excluded.stability_score,
      volatility_score = excluded.volatility_score,
      truth_temperature = excluded.truth_temperature,
      evidence_gravity = excluded.evidence_gravity,
      evidence_half_life_seconds = excluded.evidence_half_life_seconds,
      freshness_ratio = excluded.freshness_ratio,
      source_change_count = excluded.source_change_count,
      status_change_count = excluded.status_change_count,
      failure_conditions_json = excluded.failure_conditions_json,
      computed_at_ms = excluded.computed_at_ms`
  ).bind(
    state.lease_id,
    state.visual_state,
    state.stability_score,
    state.volatility_score,
    state.truth_temperature,
    state.evidence_gravity,
    state.evidence_half_life_seconds,
    state.freshness_ratio,
    state.source_change_count,
    state.status_change_count,
    JSON.stringify(state.failure_conditions),
    nowMs
  ).run();

  const dependencies = normalizeDependencies(lease.depends_on);
  for (const dependency of dependencies) {
    await db.prepare(
      `INSERT INTO truth_dependency (parent_lease_id, child_lease_id, relation, weight, created_at_ms)
       VALUES (?1, ?2, ?3, ?4, ?5)
       ON CONFLICT(parent_lease_id, child_lease_id, relation) DO UPDATE SET weight = excluded.weight`
    ).bind(dependency.lease_id, state.lease_id, dependency.relation, dependency.weight, nowMs).run();
  }

  return state;
}

export async function readTruthState(env, leaseId, nowMs = Date.now()) {
  if (!env?.LEASES || !leaseId) return null;
  const raw = await env.LEASES.get(`lease:${leaseId}`);
  if (!raw) return null;
  const lease = typeof raw === "string" ? JSON.parse(raw) : raw;
  const state = computeTruthState(lease, nowMs);

  if (env?.MONITOR_DB?.prepare) {
    try {
      await persistTruthState(env.MONITOR_DB, lease, nowMs);
      const rows = await env.MONITOR_DB.prepare(
        `SELECT parent_lease_id, relation, weight
         FROM truth_dependency WHERE child_lease_id = ?1 ORDER BY parent_lease_id LIMIT 64`
      ).bind(leaseId).all();
      state.proof_shadows = (rows?.results || []).map((row) => ({
        lease_id: row.parent_lease_id,
        relation: row.relation,
        weight: Number(row.weight)
      }));
    } catch (error) {
      console.warn(JSON.stringify({ event: "truth_state_read_d1_failed", error: safeErrorName(error) }));
    }
  }

  return state;
}

function classifyVisualState({ leaseState, verdict, freshnessRatio, stabilityScore, truthTemperature }) {
  if (leaseState === "REVOKED") return "REVOKED";
  if (leaseState === "EXPIRED") return "EXPIRED";
  if (verdict === "CONTRADICTED") return "CONTRADICTED";
  if (verdict === "UNKNOWN") return "UNKNOWN";
  if (freshnessRatio < 0.16) return "STALE";
  if (truthTemperature >= 62 || stabilityScore < 0.48) return "UNSTABLE";
  return "STABLE";
}

function inferFailureConditions(lease) {
  const conditions = [
    "SOURCE_UNAVAILABLE",
    "SOURCE_FINGERPRINT_CHANGED",
    "VERDICT_CHANGED"
  ];
  if (lease.proof_basis === "EXACT_TEXT" || lease.verifier === "deterministic-exact-match") {
    conditions.push("EXACT_EVIDENCE_DISAPPEARED");
  }
  if (String(lease.status || "").toUpperCase() === "SUPPORTED") {
    conditions.push("SUPPORT_FELL_BELOW_REQUIRED_BASIS");
  }
  return conditions;
}

function visualEnvelope(state, temperature, gravity, volatility) {
  const density = round2(clamp01(0.22 + temperature / 145 + volatility * 0.3));
  const turbulence = round2(clamp01(0.08 + volatility * 0.9));
  const eyeIntensity = round2(clamp01(0.42 + gravity / 170));
  return {
    embodiment: "LOVE_MIST",
    mist_density: density,
    mist_turbulence: turbulence,
    eye_intensity: eyeIntensity,
    motion: state === "STABLE" ? "BREATHE" : state === "UNSTABLE" ? "SEARCH" : state === "REVOKED" ? "FRACTURE" : "WATCH",
    interface_reaction: "WRAP_SEMANTIC_TARGETS"
  };
}

function normalizeDependencies(value) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 64).map((item) => {
    if (typeof item === "string") return { lease_id: item.slice(0, 120), relation: "DEPENDS_ON", weight: 1 };
    return {
      lease_id: String(item?.lease_id || "").slice(0, 120),
      relation: String(item?.relation || "DEPENDS_ON").slice(0, 40),
      weight: clamp(Number(item?.weight) || 1, 0, 1)
    };
  }).filter((item) => item.lease_id);
}

function parseTime(value, fallback) {
  const parsed = Date.parse(value || "");
  return Number.isFinite(parsed) ? parsed : fallback;
}

function clamp(value, min, max) { return Math.min(max, Math.max(min, value)); }
function clamp01(value) { return clamp(value, 0, 1); }
function round2(value) { return Math.round(value * 100) / 100; }
function round4(value) { return Math.round(value * 10000) / 10000; }
function safeErrorName(error) { return error?.name || error?.constructor?.name || "Error"; }
