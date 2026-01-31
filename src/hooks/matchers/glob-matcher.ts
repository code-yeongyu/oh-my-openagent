import type { HookMatcher, MatcherOptions } from "./types"

/**
 * Glob-based matcher for hook patterns
 * Supports basic glob syntax: *, **, ?
 */
export class GlobMatcher implements HookMatcher {
  readonly type = "glob" as const
  readonly pattern: string
  private regex: RegExp

  constructor(pattern: string, options: MatcherOptions = {}) {
    this.pattern = pattern
    this.regex = this.globToRegex(pattern, options)
  }

  private globToRegex(pattern: string, options: MatcherOptions): RegExp {
    // Handle empty pattern - matches everything
    if (!pattern || pattern === "*") {
      return new RegExp(".*")
    }

    // Normalize pattern to use forward slashes
    let normalizedPattern = pattern.replace(/\\/g, "/")

    // Use placeholders to avoid conflicts during replacement
    let regexStr = normalizedPattern
      // Escape special regex characters except glob wildcards
      .replace(/[.+^${}()|[\]\\]/g, "\\$&")
      // Replace **/ with placeholder (zero or more directories)
      .replace(/\*\*\//g, "\x00GLOBSTAR_SLASH\x00")
      // Replace /** with placeholder (anything after)
      .replace(/\/\*\*/g, "\x00SLASH_GLOBSTAR\x00")
      // Replace standalone ** with placeholder
      .replace(/\*\*/g, "\x00GLOBSTAR\x00")
      // Replace * with placeholder (single segment)
      .replace(/\*/g, "\x00STAR\x00")
      // Replace ? with placeholder
      .replace(/\?/g, "\x00QUESTION\x00")

    // Now replace placeholders with actual regex patterns
    regexStr = regexStr
      .replace(/\x00GLOBSTAR_SLASH\x00/g, "(?:[^/]+/)*")  // zero or more dir segments
      .replace(/\x00SLASH_GLOBSTAR\x00/g, "(?:/.*)?")     // optional anything after
      .replace(/\x00GLOBSTAR\x00/g, ".*")                  // anything
      .replace(/\x00STAR\x00/g, "[^/]*")                   // anything except /
      .replace(/\x00QUESTION\x00/g, "[^/]")               // single char except /

    // Anchor the pattern
    regexStr = `^${regexStr}$`

    const flags = options.caseInsensitive ? "i" : ""
    return new RegExp(regexStr, flags)
  }

  matches(value: string): boolean {
    // Normalize path separators
    const normalizedValue = value.replace(/\\/g, "/")
    return this.regex.test(normalizedValue)
  }
}

/**
 * Create a GlobMatcher from a pattern string
 */
export function createGlobMatcher(pattern: string, options?: MatcherOptions): GlobMatcher {
  return new GlobMatcher(pattern, options)
}
