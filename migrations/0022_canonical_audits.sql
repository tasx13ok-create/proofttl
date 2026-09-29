CREATE TABLE IF NOT EXISTS verification_audits (
  tenant_id TEXT NOT NULL, audit_id TEXT NOT NULL,
  created_at TEXT NOT NULL, expires_at TEXT NOT NULL, retain_until TEXT NOT NULL,
  payload_json TEXT NOT NULL, payload_sha256 TEXT NOT NULL,
  PRIMARY KEY (tenant_id, audit_id)
);
CREATE INDEX IF NOT EXISTS verification_audits_retention ON verification_audits(retain_until);
CREATE TRIGGER IF NOT EXISTS verification_audits_immutable BEFORE UPDATE ON verification_audits BEGIN SELECT RAISE(ABORT, 'immutable_audit'); END;
CREATE TABLE IF NOT EXISTS verification_leases (
  tenant_id TEXT NOT NULL, lease_id TEXT NOT NULL, audit_id TEXT NOT NULL,
  claim_result_id TEXT NOT NULL, idempotency_sha256 TEXT NOT NULL,
  request_sha256 TEXT NOT NULL, payload_json TEXT NOT NULL, retain_until TEXT NOT NULL,
  PRIMARY KEY (tenant_id, lease_id), UNIQUE (tenant_id, idempotency_sha256),
  FOREIGN KEY (tenant_id, audit_id) REFERENCES verification_audits(tenant_id, audit_id)
);
CREATE INDEX IF NOT EXISTS verification_leases_retention ON verification_leases(retain_until);
CREATE TRIGGER IF NOT EXISTS verification_leases_immutable BEFORE UPDATE ON verification_leases BEGIN SELECT RAISE(ABORT, 'immutable_lease'); END;
