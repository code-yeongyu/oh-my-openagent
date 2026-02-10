export const SESSION_TIMEOUT_MS = 10 * 60 * 1000

// Stability detection constants (prevents premature closure - see issue #1330)
// Mirrors the proven pattern from background-agent/manager.ts
export const MIN_STABILITY_TIME_MS = 10 * 1000
export const STABLE_POLLS_REQUIRED = 3
