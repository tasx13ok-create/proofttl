CREATE TABLE IF NOT EXISTS foundry_evidence (
  evidence_id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES foundry_runs(run_id) ON DELETE CASCADE,
  source_type TEXT NOT NULL,
  query_text TEXT NOT NULL,
  title TEXT NOT NULL,
  url TEXT NOT NULL,
  excerpt TEXT,
  published_at TEXT,
  source_domain TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS foundry_evidence_run_created_idx
  ON foundry_evidence(run_id, created_at DESC);

CREATE TABLE IF NOT EXISTS foundry_candidate_evidence (
  candidate_id TEXT NOT NULL REFERENCES foundry_candidates(candidate_id) ON DELETE CASCADE,
  evidence_id TEXT NOT NULL REFERENCES foundry_evidence(evidence_id) ON DELETE CASCADE,
  PRIMARY KEY (candidate_id, evidence_id)
);

CREATE INDEX IF NOT EXISTS foundry_candidate_evidence_evidence_idx
  ON foundry_candidate_evidence(evidence_id, candidate_id);
