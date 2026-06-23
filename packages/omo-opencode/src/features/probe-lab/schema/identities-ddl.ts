export const IDENTITIES_DDL = `
CREATE TABLE IF NOT EXISTS identities (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  label TEXT,
  config TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  consecutive_failures INTEGER NOT NULL DEFAULT 0,
  total_uses INTEGER NOT NULL DEFAULT 0,
  last_used_at INTEGER,
  last_failure_at INTEGER,
  quarantined_until INTEGER,
  circuit_state TEXT NOT NULL DEFAULT 'closed',
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
`
