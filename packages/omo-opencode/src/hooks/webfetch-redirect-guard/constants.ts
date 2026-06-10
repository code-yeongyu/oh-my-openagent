export const DEFAULT_WEBFETCH_TIMEOUT_MS = 30_000
export const MAX_WEBFETCH_TIMEOUT_MS = 120_000
export const MAX_WEBFETCH_REDIRECTS = 10
export const WEBFETCH_REDIRECT_GUARD_STALE_TIMEOUT_MS = 15 * 60 * 1000

export const WEBFETCH_REDIRECT_ERROR_PATTERNS = [
  /redirected too many times/i,
  /too many redirects/i,
] as const

export const WEBFETCH_REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308])
