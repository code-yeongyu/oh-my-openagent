export const TRIGGERS_DDL = `
CREATE TRIGGER IF NOT EXISTS trg_hypotheses_updated_at
  AFTER UPDATE ON hypotheses
BEGIN
  UPDATE hypotheses SET updated_at = unixepoch() WHERE id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS trg_evidence_insert_tally
  AFTER INSERT ON evidence
BEGIN
  UPDATE hypotheses SET updated_at = unixepoch() WHERE id = NEW.hypothesis_id;
END;

CREATE TRIGGER IF NOT EXISTS trg_audit_identity_status
  AFTER UPDATE OF status ON identities
  WHEN OLD.status != NEW.status
BEGIN
  INSERT INTO audit_log (entity_type, entity_id, action, changes, reason)
  VALUES ('identity', NEW.id,
    CASE NEW.status
      WHEN 'quarantined' THEN 'quarantine'
      WHEN 'active' THEN 'release'
      WHEN 'exhausted' THEN 'exhaust'
      WHEN 'revoked' THEN 'revoke'
      ELSE 'update'
    END,
    json_object('status', json_object('from', OLD.status, 'to', NEW.status)),
    COALESCE(NEW.quarantine_reason, 'manual')
  );
END;

CREATE TRIGGER IF NOT EXISTS trg_audit_hypothesis_status
  AFTER UPDATE OF status ON hypotheses
  WHEN OLD.status != NEW.status
BEGIN
  INSERT INTO audit_log (entity_type, entity_id, action, changes)
  VALUES ('hypothesis', NEW.id,
    CASE NEW.status
      WHEN 'confirmed' THEN 'confirm'
      WHEN 'refuted' THEN 'refute'
      WHEN 'superseded' THEN 'supersede'
      WHEN 'resurrected' THEN 'resurrect'
      WHEN 'active' THEN 'activate'
      ELSE 'update'
    END,
    json_object('status', json_object('from', OLD.status, 'to', NEW.status))
  );
END;

CREATE TRIGGER IF NOT EXISTS trg_audit_evidence_insert
  AFTER INSERT ON evidence
BEGIN
  INSERT INTO audit_log (entity_type, entity_id, action, changes)
  VALUES ('evidence', NEW.id, 'create',
    json_object('verdict', NEW.verdict, 'hypothesis_id', NEW.hypothesis_id)
  );
END;
`
