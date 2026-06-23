export const FINGERPRINT_PROFILES_DDL = `
CREATE TABLE IF NOT EXISTS fingerprint_profiles (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  engine TEXT NOT NULL,
  tls_fingerprint TEXT,
  http_version TEXT NOT NULL DEFAULT 'HTTP/2',
  user_agent TEXT,
  sec_ch_ua TEXT,
  sec_ch_ua_platform TEXT,
  accept_language TEXT NOT NULL DEFAULT 'en-US,en;q=0.9',
  header_order TEXT,
  extra_headers TEXT,
  proxy_required INTEGER NOT NULL DEFAULT 0,
  browser_profile TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  last_verified_at INTEGER,
  detection_score REAL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
`
