export const CANARY_LOCKS_DDL = `
CREATE TABLE IF NOT EXISTS canary_locks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  identity_id TEXT NOT NULL UNIQUE REFERENCES identities(id) ON DELETE CASCADE,
  locked_by TEXT NOT NULL,
  lock_reason TEXT NOT NULL,
  canary_test_url TEXT,
  canary_test_expected_status INTEGER NOT NULL DEFAULT 200,
  canary_test_interval_s INTEGER NOT NULL DEFAULT 60,
  last_canary_test_at INTEGER,
  last_canary_result TEXT,
  locked_at INTEGER NOT NULL DEFAULT (unixepoch()),
  unlocked_at INTEGER
);
`
