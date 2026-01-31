export type { HookMatcher, MatcherOptions, MatchResult } from "./types"
export { RegexMatcher, createRegexMatcher } from "./regex-matcher"
export { GlobMatcher, createGlobMatcher } from "./glob-matcher"

import type { HookMatcher, MatcherOptions } from "./types"
import { RegexMatcher } from "./regex-matcher"
import { GlobMatcher } from "./glob-matcher"

/**
 * Matcher type for auto-detection
 */
export type MatcherType = "regex" | "glob" | "auto"

/**
 * Create a matcher based on the pattern and type
 * @param pattern The pattern string
 * @param type The matcher type (default: "auto" - auto-detect based on pattern)
 * @param options Additional matcher options
 */
export function createMatcher(
  pattern: string,
  type: MatcherType = "auto",
  options?: MatcherOptions
): HookMatcher {
  if (type === "regex") {
    return new RegexMatcher(pattern, options)
  }

  if (type === "glob") {
    return new GlobMatcher(pattern, options)
  }

  // Auto-detect: if pattern contains glob-like characters, use glob
  // Otherwise, try regex
  const isGlobLike = /[*?]/.test(pattern) && !/^\^/.test(pattern) && !/\$$/.test(pattern)
  
  if (isGlobLike) {
    return new GlobMatcher(pattern, options)
  }

  return new RegexMatcher(pattern, options)
}

/**
 * Check if a value matches any of the provided patterns
 */
export function matchesAny(value: string, matchers: HookMatcher[]): boolean {
  return matchers.some(matcher => matcher.matches(value))
}

/**
 * Check if a value matches all of the provided patterns
 */
export function matchesAll(value: string, matchers: HookMatcher[]): boolean {
  return matchers.every(matcher => matcher.matches(value))
}
