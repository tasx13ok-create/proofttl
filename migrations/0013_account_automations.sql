-- Account-owned automation definitions.
-- Execution is intentionally separate from definition storage.

CREATE TABLE IF NOT EXISTS account_automations (
  automation_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  name TEXT NOT NULL,
  trigger_type TEXT NOT NULL,
  schedule_expr TEXT,
  condition_summary TEXT,
  action_id TEXT NOT NULL,
  action_input_json TEXT,
  risk TEXT NOT NULL,
  confirmation_mode TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_run_at TEXT,
  last_run_state TEXT
);

CREATE INDEX IF NOT EXISTS account_automations_user_updated_idx
  ON account_automations(user_id, updated_at DESC);
