ALTER TABLE audit_intakes ADD COLUMN offer_type TEXT NOT NULL DEFAULT 'full_audit';

CREATE INDEX IF NOT EXISTS idx_audit_intakes_offer_status
  ON audit_intakes (offer_type, status, created_at_ms DESC);
