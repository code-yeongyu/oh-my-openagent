export const POOL_SNAPSHOTS_DDL = `
CREATE TABLE IF NOT EXISTS pool_snapshots (
  id TEXT PRIMARY KEY,
  experiment_id TEXT REFERENCES experiments(id) ON DELETE CASCADE,
  session_id TEXT REFERENCES probe_sessions(id) ON DELETE SET NULL,
  triggered_by TEXT NOT NULL,
  snapshot_data TEXT NOT NULL,
  total_identities INTEGER,
  active_count INTEGER,
  canary_count INTEGER,
  quarantined_count INTEGER,
  exhausted_count INTEGER,
  healthy_ratio REAL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
`
