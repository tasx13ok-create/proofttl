ALTER TABLE audit_intakes ADD COLUMN scope_summary TEXT;
ALTER TABLE audit_intakes ADD COLUMN scoped_price_usd INTEGER;
ALTER TABLE audit_intakes ADD COLUMN scope_turnaround TEXT;
ALTER TABLE audit_intakes ADD COLUMN scoped_at_ms INTEGER;
ALTER TABLE audit_intakes ADD COLUMN payment_url TEXT;
ALTER TABLE audit_intakes ADD COLUMN payment_state TEXT NOT NULL DEFAULT 'not_requested';
ALTER TABLE audit_intakes ADD COLUMN paid_at_ms INTEGER;
ALTER TABLE audit_intakes ADD COLUMN fulfilled_at_ms INTEGER;

CREATE INDEX IF NOT EXISTS idx_audit_intakes_sales_state
  ON audit_intakes (status, payment_state, created_at_ms DESC);
