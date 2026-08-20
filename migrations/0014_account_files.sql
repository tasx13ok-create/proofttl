-- Native ProofTTL account file library.
-- Small text/code artifacts only; external cloud providers remain separate connections.

CREATE TABLE IF NOT EXISTS account_files (
  file_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  name TEXT NOT NULL,
  media_type TEXT NOT NULL,
  content_text TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  source TEXT NOT NULL DEFAULT 'proofttl-native',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS account_files_user_updated_idx
  ON account_files(user_id, updated_at DESC);
