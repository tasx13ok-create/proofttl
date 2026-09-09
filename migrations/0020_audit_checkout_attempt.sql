-- Persist the Stripe idempotency generation before contacting Stripe.
ALTER TABLE audit_intakes ADD COLUMN checkout_attempt_id TEXT;
