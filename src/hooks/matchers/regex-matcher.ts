import type { HookMatcher, MatcherOptions } from "./types"
import { log } from "../../shared/logger"

/**
 * Regex-based matcher for hook patterns
 */
export class RegexMatcher implements HookMatcher {
  readonly type = "regex" as const
  readonly pattern: string
  private regex: RegExp | null

  constructor(pattern: string, options: MatcherOptions = {}) {
    this.pattern = pattern
    this.regex = this.compilePattern(pattern, options)
  }

  private compilePattern(pattern: string, options: MatcherOptions): RegExp | null {
    try {
      const flags = options.caseInsensitive ? "i" : ""
      return new RegExp(pattern, flags)
    } catch (error) {
      log(`[RegexMatcher] Invalid regex pattern: ${pattern}`, error)
      return null
    }
  }

  matches(value: string): boolean {
    if (this.regex === null) {
      return false
    }
    return this.regex.test(value)
  }

  /**
   * Check if the pattern is valid
   */
  isValid(): boolean {
    return this.regex !== null
  }
}

/**
 * Create a RegexMatcher from a pattern string
 */
export function createRegexMatcher(pattern: string, options?: MatcherOptions): RegexMatcher {
  return new RegexMatcher(pattern, options)
}
