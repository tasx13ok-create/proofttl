-- Account-owned product state for ProofTTL Console, L.O.V.E., and Studio.
-- Ownership is always keyed to Better Auth user.id; no email-based ownership inference.

CREATE TABLE IF NOT EXISTS account_preferences (
  user_id TEXT PRIMARY KEY REFERENCES "user"("id") ON DELETE CASCADE,
  preferred_ai_provider TEXT,
  preferred_ai_model TEXT,
  love_voice_enabled INTEGER NOT NULL DEFAULT 1,
  love_compact_mode INTEGER NOT NULL DEFAULT 0,
  studio_autosave INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS studio_projects (
  project_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  name TEXT NOT NULL,
  language TEXT,
  files_json TEXT NOT NULL,
  active_file TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS studio_projects_user_updated_idx
  ON studio_projects(user_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS account_audit_links (
  user_id TEXT NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  intake_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (user_id, intake_id)
);

CREATE INDEX IF NOT EXISTS account_audit_links_intake_idx
  ON account_audit_links(intake_id);
