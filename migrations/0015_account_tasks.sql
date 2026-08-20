CREATE TABLE IF NOT EXISTS account_tasks (
  task_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  title TEXT NOT NULL,
  notes TEXT,
  priority TEXT NOT NULL DEFAULT 'normal',
  status TEXT NOT NULL DEFAULT 'open',
  due_at TEXT,
  source TEXT NOT NULL DEFAULT 'proofttl-native',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT
);

CREATE INDEX IF NOT EXISTS account_tasks_user_status_due_idx
  ON account_tasks(user_id, status, due_at, updated_at DESC);
