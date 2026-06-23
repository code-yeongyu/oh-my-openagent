export const HYPOTHESES_DDL = `
CREATE TABLE IF NOT EXISTS hypotheses (
  id TEXT PRIMARY KEY,
  text TEXT NOT NULL,
  falsifiability_criteria TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  confidence REAL NOT NULL DEFAULT 0.5,
  aspic_theory_template TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);
`
