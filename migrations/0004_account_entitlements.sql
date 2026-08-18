CREATE TABLE IF NOT EXISTS account_entitlement (
  user_id TEXT PRIMARY KEY,
  plan TEXT NOT NULL DEFAULT 'free',
  membership_status TEXT NOT NULL DEFAULT 'inactive',
  assistant_daily_limit INTEGER,
  period_end_ms INTEGER,
  source TEXT NOT NULL DEFAULT 'system',
  updated_at_ms INTEGER NOT NULL,
  FOREIGN KEY (user_id) REFERENCES user(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_account_entitlement_status
  ON account_entitlement (membership_status, plan);
