CREATE TABLE IF NOT EXISTS assistant_usage_daily (
  subject_hash TEXT NOT NULL,
  usage_day TEXT NOT NULL,
  used_messages INTEGER NOT NULL DEFAULT 0,
  updated_at_ms INTEGER NOT NULL,
  PRIMARY KEY (subject_hash, usage_day)
);

CREATE INDEX IF NOT EXISTS idx_assistant_usage_day
  ON assistant_usage_daily (usage_day);
