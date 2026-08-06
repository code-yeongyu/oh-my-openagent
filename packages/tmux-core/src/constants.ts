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

// Grace period after spawn during which panes auto-activate without requiring
// the user to focus them. Without this, the pane shows only the sleeping
// placeholder ("Focus this pane to attach.") until the user manually
// focuses it, which looks like "tmux window shows no content".
export const AUTO_ACTIVATE_GRACE_MS = 5_000  // 5 seconds
