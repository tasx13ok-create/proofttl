const DEFAULT_DUE_LIMIT = 10;
const MAX_RECONCILE_BATCH = 100;

export function monitorScheduleRow(lease, updatedAtMs = Date.now()) {
  const leaseId = typeof lease?.lease_id === "string" ? lease.lease_id.trim() : "";
  if (!leaseId) throw new Error("monitor_schedule_lease_id_required");

  const expiresAtMs = Date.parse(lease?.expires_at || "");
  if (!Number.isFinite(expiresAtMs)) throw new Error("monitor_schedule_invalid_expiry");

  const nextCheckAtMs = lease?.next_check_at ? Date.parse(lease.next_check_at) : null;
  if (nextCheckAtMs !== null && !Number.isFinite(nextCheckAtMs)) {
    throw new Error("monitor_schedule_invalid_next_check");
  }

  return {
    lease_id: leaseId,
    lease_state: String(lease?.lease_state || "ACTIVE"),
    next_check_at_ms: nextCheckAtMs,
    expires_at_ms: expiresAtMs,
    updated_at_ms: Number.isFinite(updatedAtMs) ? Math.trunc(updatedAtMs) : Date.now()
  };
}

export function monitorScheduleRowFromKvKey(key, updatedAtMs = Date.now()) {
  const name = typeof key?.name === "string" ? key.name : "";
  if (!name.startsWith("lease:")) return null;
  const metadata = key?.metadata || {};
  const expiresAt = metadata.expires_at;
  if (!expiresAt) return null;

  try {
    return monitorScheduleRow(
      {
        lease_id: name.slice("lease:".length),
        lease_state: metadata.lease_state || "ACTIVE",
        expires_at: expiresAt,
        next_check_at: metadata.next_check_at || null
      },
      updatedAtMs
    );
  } catch {
    return null;
  }
}

export async function upsertMonitorSchedule(db, lease, updatedAtMs = Date.now()) {
  if (!db) return false;
  const row = monitorScheduleRow(lease, updatedAtMs);
  await upsertStatement(db, row).run();
  return true;
}

export async function reconcileMonitorScheduleBatch(db, keys, updatedAtMs = Date.now()) {
  if (!db || !Array.isArray(keys) || keys.length === 0) return 0;

  const rows = keys
    .slice(0, MAX_RECONCILE_BATCH)
    .map((key) => monitorScheduleRowFromKvKey(key, updatedAtMs))
    .filter(Boolean);

  if (rows.length === 0) return 0;
  await db.batch(rows.map((row) => upsertStatement(db, row)));
  return rows.length;
}

export async function listDueLeaseIds(db, nowMs = Date.now(), limit = DEFAULT_DUE_LIMIT) {
  if (!db) return [];
  const safeNow = Number.isFinite(nowMs) ? Math.trunc(nowMs) : Date.now();
  const safeLimit = normalizeLimit(limit);

  const result = await db
    .prepare(`
      SELECT lease_id
      FROM monitor_schedule
      WHERE lease_state = 'ACTIVE'
        AND (
          expires_at_ms <= ?1
          OR (next_check_at_ms IS NOT NULL AND next_check_at_ms <= ?1)
        )
      ORDER BY
        CASE
          WHEN expires_at_ms <= ?1 THEN expires_at_ms
          ELSE next_check_at_ms
        END ASC,
        lease_id ASC
      LIMIT ?2
    `)
    .bind(safeNow, safeLimit)
    .run();

  const rows = Array.isArray(result?.results) ? result.results : [];
  return rows
    .map((row) => (typeof row?.lease_id === "string" ? row.lease_id : null))
    .filter(Boolean);
}

export async function markMissingLeaseInactive(db, leaseId, updatedAtMs = Date.now()) {
  if (!db || typeof leaseId !== "string" || !leaseId) return false;

  await db
    .prepare(`
      UPDATE monitor_schedule
      SET lease_state = 'MISSING', next_check_at_ms = NULL, updated_at_ms = ?2
      WHERE lease_id = ?1
    `)
    .bind(leaseId, Number.isFinite(updatedAtMs) ? Math.trunc(updatedAtMs) : Date.now())
    .run();

  return true;
}

function upsertStatement(db, row) {
  return db
    .prepare(`
      INSERT INTO monitor_schedule (
        lease_id,
        lease_state,
        next_check_at_ms,
        expires_at_ms,
        updated_at_ms
      ) VALUES (?1, ?2, ?3, ?4, ?5)
      ON CONFLICT(lease_id) DO UPDATE SET
        lease_state = excluded.lease_state,
        next_check_at_ms = excluded.next_check_at_ms,
        expires_at_ms = excluded.expires_at_ms,
        updated_at_ms = excluded.updated_at_ms
    `)
    .bind(
      row.lease_id,
      row.lease_state,
      row.next_check_at_ms,
      row.expires_at_ms,
      row.updated_at_ms
    );
}

function normalizeLimit(value) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_DUE_LIMIT;
  return Math.min(parsed, 100);
}
