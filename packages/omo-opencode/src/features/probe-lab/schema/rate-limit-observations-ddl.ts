export const RATE_LIMIT_OBSERVATIONS_DDL = `
CREATE TABLE IF NOT EXISTS rate_limit_observations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  identity_id TEXT REFERENCES identities(id) ON DELETE CASCADE,
  provider_id TEXT REFERENCES provider_credentials(id) ON DELETE CASCADE,
  exchange_id INTEGER REFERENCES probe_exchanges(id) ON DELETE SET NULL,
  type TEXT NOT NULL,
  http_status INTEGER,
  retry_after_s INTEGER,
  response_body_preview TEXT,
  timestamp INTEGER NOT NULL DEFAULT (unixepoch())
);
`
