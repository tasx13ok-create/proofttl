CREATE TABLE IF NOT EXISTS owner_desk_tasks (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  done INTEGER NOT NULL DEFAULT 0,
  created_by TEXT NOT NULL,
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS owner_audit_notes (
  id TEXT PRIMARY KEY,
  intake_id TEXT NOT NULL REFERENCES audit_intakes(id),
  body TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at_ms INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_owner_notes_intake ON owner_audit_notes(intake_id, created_at_ms);
CREATE TABLE IF NOT EXISTS owner_audit_events (
  id TEXT PRIMARY KEY,
  intake_id TEXT NOT NULL REFERENCES audit_intakes(id),
  action TEXT NOT NULL,
  actor TEXT NOT NULL,
  created_at_ms INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_owner_events_intake ON owner_audit_events(intake_id, created_at_ms);
CREATE TABLE IF NOT EXISTS owner_audit_reports (
  intake_id TEXT PRIMARY KEY REFERENCES audit_intakes(id),
  body TEXT NOT NULL,
  sha256 TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  updated_at_ms INTEGER NOT NULL
);
CREATE TRIGGER IF NOT EXISTS owner_report_insert_guard BEFORE INSERT ON owner_audit_reports
BEGIN
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM audit_intakes WHERE id=NEW.intake_id AND status='paid')
    THEN RAISE(ABORT,'report_requires_paid_audit') END;
END;
CREATE TRIGGER IF NOT EXISTS owner_report_update_guard BEFORE UPDATE ON owner_audit_reports
BEGIN
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM audit_intakes WHERE id=NEW.intake_id AND status='paid')
    THEN RAISE(ABORT,'delivered_report_is_immutable') END;
END;
CREATE TRIGGER IF NOT EXISTS owner_report_insert_review AFTER INSERT ON owner_audit_reports
BEGIN
  UPDATE audit_intakes SET human_approved_at_ms=NULL,human_approved_by=NULL,report_sha256=NULL WHERE id=NEW.intake_id;
END;
CREATE TRIGGER IF NOT EXISTS owner_report_update_review AFTER UPDATE ON owner_audit_reports
BEGIN
  UPDATE audit_intakes SET human_approved_at_ms=NULL,human_approved_by=NULL,report_sha256=NULL WHERE id=NEW.intake_id;
END;
