-- Universal ProofTTL action ledger.
-- Stores safe summaries and execution state, never provider secrets or raw credentials.

CREATE TABLE IF NOT EXISTS action_receipts (
  receipt_id TEXT PRIMARY KEY,
  user_id TEXT REFERENCES "user"("id") ON DELETE CASCADE,
  action_id TEXT NOT NULL,
  area TEXT NOT NULL,
  risk TEXT NOT NULL,
  confirmation_required INTEGER NOT NULL DEFAULT 0,
  confirmed INTEGER NOT NULL DEFAULT 0,
  state TEXT NOT NULL DEFAULT 'planned',
  provider TEXT,
  input_summary TEXT,
  result_summary TEXT,
  error_code TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT
);

CREATE INDEX IF NOT EXISTS action_receipts_user_updated_idx
  ON action_receipts(user_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS action_receipts_state_updated_idx
  ON action_receipts(state, updated_at DESC);
