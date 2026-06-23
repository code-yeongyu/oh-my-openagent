export const PROBE_SESSIONS_DDL = `
CREATE TABLE IF NOT EXISTS probe_sessions (
  id TEXT PRIMARY KEY,
  hypothesis_id TEXT REFERENCES hypotheses(id) ON DELETE SET NULL,
  identity_id TEXT REFERENCES identities(id) ON DELETE SET NULL,
  config TEXT,
  started_at INTEGER NOT NULL DEFAULT (unixepoch()),
  ended_at INTEGER
);
`
