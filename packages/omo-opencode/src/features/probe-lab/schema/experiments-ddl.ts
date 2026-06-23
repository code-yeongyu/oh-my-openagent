export const EXPERIMENTS_DDL = `
CREATE TABLE IF NOT EXISTS experiments (
  id TEXT PRIMARY KEY,
  hypothesis_id TEXT NOT NULL REFERENCES hypotheses(id) ON DELETE CASCADE,
  question_id TEXT REFERENCES questions(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  description TEXT,
  protocol TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  expected_outcome TEXT,
  safety_budget TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  started_at INTEGER,
  completed_at INTEGER
);
`
