export const EVIDENCE_DDL = `
CREATE TABLE IF NOT EXISTS evidence (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  hypothesis_id TEXT NOT NULL REFERENCES hypotheses(id) ON DELETE CASCADE,
  session_id TEXT NOT NULL REFERENCES probe_sessions(id) ON DELETE CASCADE,
  exchange_id INTEGER REFERENCES probe_exchanges(id) ON DELETE SET NULL,
  verdict TEXT NOT NULL,
  confidence REAL,
  reasoning TEXT,
  aspic_preference_impact TEXT,
  kb_entry_id TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
`
