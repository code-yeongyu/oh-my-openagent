export const PROBE_EXCHANGES_DDL = `
CREATE TABLE IF NOT EXISTS probe_exchanges (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL REFERENCES probe_sessions(id) ON DELETE CASCADE,
  timestamp INTEGER NOT NULL DEFAULT (unixepoch()),
  method TEXT NOT NULL,
  url TEXT NOT NULL,
  request_headers TEXT,
  request_body BLOB,
  response_status INTEGER,
  response_headers TEXT,
  response_body BLOB,
  timing_total_ms INTEGER,
  was_forwarded_as_is INTEGER NOT NULL DEFAULT 0
);
`
