CREATE TABLE IF NOT EXISTS monitor_schedule (
  lease_id TEXT PRIMARY KEY,
  lease_state TEXT NOT NULL,
  next_check_at_ms INTEGER,
  expires_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_monitor_schedule_due
  ON monitor_schedule (lease_state, next_check_at_ms);

CREATE INDEX IF NOT EXISTS idx_monitor_schedule_expiry
  ON monitor_schedule (lease_state, expires_at_ms);
