export const PROVIDER_CREDENTIALS_DDL = `
CREATE TABLE IF NOT EXISTS provider_credentials (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  provider_type TEXT NOT NULL,
  base_url TEXT NOT NULL,
  auth_type TEXT NOT NULL,
  auth_config TEXT NOT NULL,
  default_headers TEXT,
  rate_limit_rps REAL,
  rate_limit_rpm REAL,
  rate_limit_tpm REAL,
  cooldown_on_429_s INTEGER NOT NULL DEFAULT 90,
  supported_models TEXT,
  health_check_url TEXT,
  health_check_interval_s INTEGER NOT NULL DEFAULT 300,
  status TEXT NOT NULL DEFAULT 'active',
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);
`
