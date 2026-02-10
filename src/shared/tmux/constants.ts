// Polling interval for background session status checks
export const POLL_INTERVAL_BACKGROUND_MS = 2000

// Maximum idle time before session considered stale
export const SESSION_TIMEOUT_MS = 10 * 60 * 1000  // 10 minutes

// Grace period for missing session before cleanup
export const SESSION_MISSING_GRACE_MS = 6000  // 6 seconds

// Session readiness polling config
export const SESSION_READY_POLL_INTERVAL_MS = 500
export const SESSION_READY_TIMEOUT_MS = 10_000  // 10 seconds max wait
