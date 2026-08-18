CREATE TABLE IF NOT EXISTS audit_intakes (
  id TEXT PRIMARY KEY,
  created_at_ms INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'received',
  email TEXT NOT NULL,
  company_or_project TEXT NOT NULL,
  website_url TEXT,
  claim_scope TEXT NOT NULL,
  approximate_claims TEXT NOT NULL,
  why_it_matters TEXT NOT NULL,
  deadline TEXT,
  request_fingerprint TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_audit_intakes_created_at
  ON audit_intakes(created_at_ms DESC);

CREATE INDEX IF NOT EXISTS idx_audit_intakes_fingerprint_created
  ON audit_intakes(request_fingerprint, created_at_ms DESC);
