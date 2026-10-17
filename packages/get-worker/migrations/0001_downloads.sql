-- Daily download counts rolled up from the omo_downloads Analytics Engine dataset by the hourly cron.
CREATE TABLE IF NOT EXISTS downloads_daily (
  day TEXT NOT NULL,
  kind TEXT NOT NULL,
  source TEXT NOT NULL,
  version TEXT NOT NULL,
  asset TEXT NOT NULL,
  count INTEGER NOT NULL,
  PRIMARY KEY (day, kind, source, version, asset)
);

-- Signed corrections to the public total, e.g. subtracting QA installs; every row carries its reason.
CREATE TABLE IF NOT EXISTS download_adjustments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  delta INTEGER NOT NULL,
  reason TEXT NOT NULL
);
