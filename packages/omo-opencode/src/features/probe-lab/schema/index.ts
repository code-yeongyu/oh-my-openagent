import { PROVIDER_CREDENTIALS_DDL } from "./provider-credentials-ddl"
import { FINGERPRINT_PROFILES_DDL } from "./fingerprint-profiles-ddl"
import { QUESTIONS_DDL } from "./questions-ddl"
import { HYPOTHESES_DDL } from "./hypotheses-ddl"
import { EXPERIMENTS_DDL } from "./experiments-ddl"
import { IDENTITIES_DDL } from "./identities-ddl"
import { PROBE_SESSIONS_DDL } from "./probe-sessions-ddl"
import { PROBE_EXCHANGES_DDL } from "./probe-exchanges-ddl"
import { EVIDENCE_DDL } from "./evidence-ddl"
import { RATE_LIMIT_OBSERVATIONS_DDL } from "./rate-limit-observations-ddl"
import { POOL_SNAPSHOTS_DDL } from "./pool-snapshots-ddl"
import { CANARY_LOCKS_DDL } from "./canary-locks-ddl"
import { CAPTURES_DDL } from "./captures-ddl"
import { AUDIT_LOG_DDL } from "./audit-log-ddl"
import { ALERT_HISTORY_DDL } from "./alert-history-ddl"
import { PROBE_LAB_CONFIG_DDL } from "./probe-lab-config-ddl"
import { SCHEMA_MIGRATIONS_DDL } from "./schema-migrations-ddl"
import { INDEXES_DDL } from "./indexes-ddl"
import { TRIGGERS_DDL } from "./triggers-ddl"

export const PROBE_LAB_SCHEMA = [
  PROVIDER_CREDENTIALS_DDL,
  FINGERPRINT_PROFILES_DDL,
  QUESTIONS_DDL,
  HYPOTHESES_DDL,
  EXPERIMENTS_DDL,
  IDENTITIES_DDL,
  PROBE_SESSIONS_DDL,
  PROBE_EXCHANGES_DDL,
  EVIDENCE_DDL,
  RATE_LIMIT_OBSERVATIONS_DDL,
  POOL_SNAPSHOTS_DDL,
  CANARY_LOCKS_DDL,
  CAPTURES_DDL,
  AUDIT_LOG_DDL,
  ALERT_HISTORY_DDL,
  PROBE_LAB_CONFIG_DDL,
  SCHEMA_MIGRATIONS_DDL,
  INDEXES_DDL,
  TRIGGERS_DDL,
].join("\n")
