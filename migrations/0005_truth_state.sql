CREATE TABLE IF NOT EXISTS truth_state (
  lease_id TEXT PRIMARY KEY,
  visual_state TEXT NOT NULL,
  stability_score REAL NOT NULL,
  volatility_score REAL NOT NULL,
  truth_temperature REAL NOT NULL,
  evidence_gravity REAL NOT NULL,
  evidence_half_life_seconds INTEGER NOT NULL,
  freshness_ratio REAL NOT NULL,
  source_change_count INTEGER NOT NULL DEFAULT 0,
  status_change_count INTEGER NOT NULL DEFAULT 0,
  failure_conditions_json TEXT NOT NULL DEFAULT '[]',
  computed_at_ms INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_truth_state_temperature
  ON truth_state (truth_temperature DESC);

CREATE INDEX IF NOT EXISTS idx_truth_state_visual
  ON truth_state (visual_state, computed_at_ms DESC);

CREATE TABLE IF NOT EXISTS truth_dependency (
  parent_lease_id TEXT NOT NULL,
  child_lease_id TEXT NOT NULL,
  relation TEXT NOT NULL DEFAULT 'DEPENDS_ON',
  weight REAL NOT NULL DEFAULT 1.0,
  created_at_ms INTEGER NOT NULL,
  PRIMARY KEY (parent_lease_id, child_lease_id, relation)
);

CREATE INDEX IF NOT EXISTS idx_truth_dependency_parent
  ON truth_dependency (parent_lease_id);

CREATE INDEX IF NOT EXISTS idx_truth_dependency_child
  ON truth_dependency (child_lease_id);
