ALTER TABLE audit_intakes ADD COLUMN human_approved_at_ms INTEGER;
ALTER TABLE audit_intakes ADD COLUMN human_approved_by TEXT;
ALTER TABLE audit_intakes ADD COLUMN report_url TEXT;
ALTER TABLE audit_intakes ADD COLUMN report_sha256 TEXT;
ALTER TABLE audit_intakes ADD COLUMN report_delivered_at_ms INTEGER;
ALTER TABLE audit_intakes ADD COLUMN watch_started_at_ms INTEGER;
ALTER TABLE audit_intakes ADD COLUMN watch_ends_at_ms INTEGER;

CREATE INDEX IF NOT EXISTS idx_audit_intakes_watch_ends
  ON audit_intakes(watch_ends_at_ms);
