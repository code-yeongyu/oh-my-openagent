/**
 * HookMatcher interface for pattern matching in hooks
 * Supports regex and glob patterns for flexible file/path matching
 */
export interface HookMatcher {
  /**
   * Check if the given value matches the pattern
   */
  matches(value: string): boolean

  /**
   * Get the original pattern string
   */
  readonly pattern: string

  /**
   * Get the matcher type
   */
  readonly type: "regex" | "glob" | "exact"
}

/**
 * Options for creating a matcher
 */
export interface MatcherOptions {
  /**
   * Whether the match should be case-insensitive (default: false)
   */
  caseInsensitive?: boolean
}

/**
 * Result of a match operation with additional context
 */
export interface MatchResult {
  matched: boolean
  pattern: string
  value: string
  matcherType: "regex" | "glob" | "exact"
}
