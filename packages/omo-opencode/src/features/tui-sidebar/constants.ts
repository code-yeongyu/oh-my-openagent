export const MIRROR_DIR_NAME = "tui-state"
export const MIRROR_SCHEMA_VERSION = 1
export const STALE_MS = 6_000
export const LOOP_FRESH_MS = 120_000
export const POLL_INTERVAL_MS = 1_000
export const HEARTBEAT_MS = 2_000
// A TUI that reads the mirror touches a lease next to it; the server's heartbeat refreshes the mirror only
// while that lease is fresh. Folders without a TUI (an app-managed backend) then cost one stat per heartbeat.
export const READER_LEASE_MS = 10_000
export const READER_LEASE_TOUCH_MS = 2_000
export const WRITE_DEBOUNCE_MS = 250
export const MAX_AGENTS = 12
export const MAX_JOBS = 12
export const LABEL_MAX = 24
