export const CAPTURES_DDL = `
CREATE TABLE IF NOT EXISTS captures (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES probe_sessions(id) ON DELETE CASCADE,
  format TEXT NOT NULL DEFAULT 'jsonl',
  file_path TEXT NOT NULL,
  file_size_bytes INTEGER,
  exchange_count INTEGER,
  compressed INTEGER NOT NULL DEFAULT 0,
  checksum_sha256 TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
`
