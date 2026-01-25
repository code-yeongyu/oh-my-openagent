// Polling interval for background session status checks
export const POLL_INTERVAL_BACKGROUND_MS = 2000

// Maximum idle time before session considered stale
export const SESSION_TIMEOUT_MS = 10 * 60 * 1000  // 10 minutes

// Grace period for missing session before cleanup
export const SESSION_MISSING_GRACE_MS = 6000  // 6 seconds

// Delay after pane spawn before sending prompt
export const PANE_SPAWN_DELAY_MS = 500
