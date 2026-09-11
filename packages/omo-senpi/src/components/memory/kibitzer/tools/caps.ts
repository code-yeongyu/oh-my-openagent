// Output caps for the sidecar's read-only tools. Every tool result is bounded by one of these
// BEFORE it reaches the child model, so a large file, a chatty grep, or a long transcript can never
// blow the sidecar's context budget. Internal defaults, tunable by the composition, not by config.

export interface KibitzerToolCaps {
  /** Characters of file content returned by `read`. */
  readonly readChars: number
  /** Matching lines returned by `grep`. */
  readonly grepMatches: number
  /** Characters kept per matching `grep` line. */
  readonly grepLineChars: number
  /** Entries returned per `session_entries` page. */
  readonly sessionEntries: number
  /** Characters kept per `session_entries` entry. */
  readonly sessionEntryChars: number
  /** Hits returned by the memory `search` operation. */
  readonly memorySearchResults: number
  /** Characters of body returned by the memory `read` operation. */
  readonly memoryReadChars: number
}

export const DEFAULT_KIBITZER_TOOL_CAPS: KibitzerToolCaps = {
  readChars: 6000,
  grepMatches: 40,
  grepLineChars: 200,
  sessionEntries: 30,
  sessionEntryChars: 600,
  memorySearchResults: 8,
  memoryReadChars: 6000,
}

export function resolveKibitzerToolCaps(overrides: Partial<KibitzerToolCaps> | undefined): KibitzerToolCaps {
  return { ...DEFAULT_KIBITZER_TOOL_CAPS, ...overrides }
}
