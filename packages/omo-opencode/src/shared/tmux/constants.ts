// Polling interval for background session status checks
export const POLL_INTERVAL_BACKGROUND_MS = 2000

// Long-running subagent work can legitimately stay open for a while.
// The tmux-subagent stability fixes raised this guard from 10 minutes after
// polling closed active panes during long tasks.
export const SESSION_TIMEOUT_MS = 60 * 60 * 1000  // 60 minutes

// Status queries can transiently miss live sessions under load.
// The tmux-subagent stability fixes raised this guard from 6 seconds after
// false missing detections closed healthy panes.
export const SESSION_MISSING_GRACE_MS = 30 * 1000  // 30 seconds

// Session readiness polling config
export const SESSION_READY_POLL_INTERVAL_MS = 500
export const SESSION_READY_TIMEOUT_MS = 10_000  // 10 seconds max wait

// Cap on how long a placeholder pane (never activated, no server status reply)
// is allowed to linger before polling treats it as a zombie and queues it for
// close. Generous because legitimate setup may take a while (slow attach,
// deferred spawn, etc.) — significantly longer than SESSION_TIMEOUT_MS so
// panes the user is about to attach to don't get killed under them. Without
// this guard, panes that the user never focuses accumulate indefinitely
// because polling skips every close check while attachActivated stays false.
export const PLACEHOLDER_PANE_TIMEOUT_MS = 30 * 60 * 1000
