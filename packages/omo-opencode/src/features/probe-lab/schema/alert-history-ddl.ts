export const ALERT_HISTORY_DDL = `
CREATE TABLE IF NOT EXISTS alert_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  rule_name TEXT NOT NULL,
  severity TEXT NOT NULL,
  message TEXT NOT NULL,
  entity_id TEXT,
  fired_at INTEGER NOT NULL DEFAULT (unixepoch()),
  acknowledged_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_alert_history_rule_entity_fired
  ON alert_history(rule_name, entity_id, fired_at DESC);
`
