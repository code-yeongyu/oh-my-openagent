export const PROBE_LAB_CONFIG_DDL = `
CREATE TABLE IF NOT EXISTS probe_lab_config (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  description TEXT,
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);
`
