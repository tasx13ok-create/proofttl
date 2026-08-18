CREATE TABLE IF NOT EXISTS mira_observation (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at_ms INTEGER NOT NULL,
  task_class TEXT NOT NULL,
  strategy_id TEXT NOT NULL,
  model_id TEXT,
  success INTEGER NOT NULL CHECK (success IN (0, 1)),
  latency_ms INTEGER NOT NULL,
  prompt_tokens INTEGER,
  completion_tokens INTEGER,
  retries INTEGER NOT NULL DEFAULT 0,
  quality_score REAL,
  reliability_score REAL NOT NULL,
  cost_units REAL,
  metadata_json TEXT
);

CREATE INDEX IF NOT EXISTS idx_mira_observation_task_created
  ON mira_observation(task_class, created_at_ms DESC);

CREATE TABLE IF NOT EXISTS mira_candidate (
  id TEXT PRIMARY KEY,
  created_at_ms INTEGER NOT NULL,
  task_class TEXT NOT NULL,
  baseline_strategy_id TEXT NOT NULL,
  candidate_strategy_id TEXT NOT NULL,
  hypothesis TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('PROPOSED', 'TESTING', 'SUPPORTED', 'REJECTED', 'STALE')),
  baseline_score REAL,
  candidate_score REAL,
  reliability_floor REAL NOT NULL DEFAULT 0.98,
  evidence_count INTEGER NOT NULL DEFAULT 0,
  evidence_json TEXT,
  expires_at_ms INTEGER
);

CREATE INDEX IF NOT EXISTS idx_mira_candidate_task_status
  ON mira_candidate(task_class, status, created_at_ms DESC);
