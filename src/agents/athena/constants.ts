export const COUNCIL_DEFAULTS = {
  CLEANUP_DELAY_MS: 30 * 60 * 1000,
  /** Timeout for waiting on individual council member responses */
  MEMBER_WAIT_TIMEOUT_MS: 30000,
  STUCK_THRESHOLD_SECONDS: 120,
  MEMBER_MAX_RUNNING_SECONDS: 1800,
  ARCHIVE_ID_BYTES: 8,
  /** TTL for council member background tasks (2 hours) */
  COUNCIL_MEMBER_TTL_MS: 2 * 60 * 60 * 1000,
  /** Quorum threshold for council decisions (60%) */
  QUORUM_THRESHOLD: 0.6,
  /** Maximum retry attempts for failed council members */
  MAX_RETRIES: 2,
  /** Maximum length for archive names */
  ARCHIVE_NAME_MAX_LENGTH: 200,
} as const
