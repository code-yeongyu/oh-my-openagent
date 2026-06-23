export const INDEXES_DDL = `
CREATE INDEX IF NOT EXISTS idx_exchanges_session ON probe_exchanges(session_id, timestamp);
CREATE INDEX IF NOT EXISTS idx_hypotheses_status ON hypotheses(status);
CREATE INDEX IF NOT EXISTS idx_evidence_hypothesis ON evidence(hypothesis_id);
CREATE INDEX IF NOT EXISTS idx_identities_status ON identities(status);
CREATE UNIQUE INDEX IF NOT EXISTS idx_identities_label ON identities(label) WHERE label IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_questions_status ON questions(status);
CREATE INDEX IF NOT EXISTS idx_questions_domain ON questions(domain);
CREATE INDEX IF NOT EXISTS idx_experiments_hypothesis ON experiments(hypothesis_id);
CREATE INDEX IF NOT EXISTS idx_experiments_status ON experiments(status);
CREATE INDEX IF NOT EXISTS idx_rate_limits_identity_ts ON rate_limit_observations(identity_id, timestamp);
CREATE INDEX IF NOT EXISTS idx_rate_limits_provider_ts ON rate_limit_observations(provider_id, timestamp);
CREATE INDEX IF NOT EXISTS idx_captures_session ON captures(session_id);
`
