ALTER TABLE audit_intakes ADD COLUMN prior_credit_usd INTEGER NOT NULL DEFAULT 0;
ALTER TABLE audit_intakes ADD COLUMN amount_due_usd INTEGER;
ALTER TABLE audit_intakes ADD COLUMN payment_provider TEXT;
ALTER TABLE audit_intakes ADD COLUMN stripe_checkout_session_id TEXT;
ALTER TABLE audit_intakes ADD COLUMN stripe_payment_intent_id TEXT;
ALTER TABLE audit_intakes ADD COLUMN stripe_last_event_id TEXT;
ALTER TABLE audit_intakes ADD COLUMN payment_created_at_ms INTEGER;

CREATE TABLE IF NOT EXISTS stripe_webhook_events (
  event_id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  received_at_ms INTEGER NOT NULL,
  audit_intake_id TEXT,
  processed INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_stripe_events_audit_intake
  ON stripe_webhook_events(audit_intake_id, received_at_ms DESC);
