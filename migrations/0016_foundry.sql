CREATE TABLE IF NOT EXISTS foundry_runs (
  run_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  objective TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'running',
  stage TEXT NOT NULL DEFAULT 'discover',
  rounds_completed INTEGER NOT NULL DEFAULT 0,
  max_rounds INTEGER NOT NULL DEFAULT 5,
  model_calls INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS foundry_runs_user_updated_idx
  ON foundry_runs(user_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS foundry_candidates (
  candidate_id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES foundry_runs(run_id) ON DELETE CASCADE,
  parent_id TEXT,
  generation INTEGER NOT NULL DEFAULT 0,
  title TEXT NOT NULL,
  customer TEXT,
  problem TEXT,
  business_model TEXT,
  asymmetry TEXT,
  why_now TEXT,
  revenue_math TEXT,
  risks_json TEXT NOT NULL DEFAULT '[]',
  red_team TEXT,
  score REAL,
  evidence_confidence REAL,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS foundry_candidates_run_score_idx
  ON foundry_candidates(run_id, status, score DESC, created_at ASC);

CREATE TABLE IF NOT EXISTS foundry_events (
  event_id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES foundry_runs(run_id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  message TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS foundry_events_run_created_idx
  ON foundry_events(run_id, created_at DESC);
