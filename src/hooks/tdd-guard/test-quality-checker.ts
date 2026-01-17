/**
 * Test Quality Checker
 *
 * Validates test quality: non-empty, has assertions, no trivial assertions.
 * Adapted from superpowers-core/lib/test-quality-checker.ts
 *
 * Note: This is a simplified version that uses regex-based checking.
 * The original uses @babel/parser for AST analysis, but we avoid that
 * dependency to keep the bundle size small.
 */

import type { SupportedLanguage, TestQualityResult, TestQualityOptions } from "./types"
import { TRIVIAL_ASSERTIONS, LANGUAGE_PATTERNS } from "./constants"
import { detectLanguage } from "./language-adapter"

/**
 * Check test quality using regex analysis
 */
export function checkTestQuality(
  content: string,
  filePath: string,
  options: TestQualityOptions
): TestQualityResult {
  const lang = detectLanguage(filePath)
  return checkTestQualityRegex(content, lang, options)
}

/**
 * Regex-based quality check
 */
function checkTestQualityRegex(
  content: string,
  lang: SupportedLanguage,
  options: TestQualityOptions
): TestQualityResult {
  const errors: string[] = []
  const warnings: string[] = []

  const patterns = LANGUAGE_PATTERNS[lang]?.assertionPatterns ?? []

  // Check for assertions
  if (options.rejectMissingAssertions && patterns.length > 0) {
    const hasAssertion = patterns.some((p) => p.test(content))
    if (!hasAssertion) {
      errors.push("No assertions found in test file")
    }
  }

  // Check trivial assertions
  if (options.rejectTrivialAssertions) {
    for (const pattern of TRIVIAL_ASSERTIONS) {
      if (pattern.test(content)) {
        errors.push("Trivial assertion detected (e.g., expect(true).toBe(true))")
        break
      }
    }
  }

  // Check for empty test bodies
  if (options.rejectEmptyTests) {
    // TypeScript/JavaScript: empty test blocks
    if (lang === "typescript" || lang === "javascript") {
      // Match test/it with empty arrow function or function
      const emptyTestPattern = /(?:test|it)\s*\(\s*['"][^'"]+['"]\s*,\s*(?:async\s*)?\(\s*\)\s*=>\s*\{\s*\}\s*\)/
      if (emptyTestPattern.test(content)) {
        errors.push("Empty test body detected")
      }
    }
    
    // Python: test with just pass
    if (lang === "python") {
      if (/def\s+test_\w+\([^)]*\):\s*pass\s*$/m.test(content)) {
        errors.push("Empty test body (pass only)")
      }
    }
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
  }
}

/**
 * Quick check if content has any meaningful assertions
 */
export function hasNonTrivialAssertions(content: string, filePath: string): boolean {
  const lang = detectLanguage(filePath)
  const patterns = LANGUAGE_PATTERNS[lang]?.assertionPatterns ?? []
  
  // Must have at least one assertion
  const hasAssertion = patterns.some((p) => p.test(content))
  if (!hasAssertion) {
    return false
  }
  
  // Must not be only trivial assertions
  const hasTrivial = TRIVIAL_ASSERTIONS.some((p) => p.test(content))
  if (hasTrivial) {
    // Check if there are non-trivial assertions too
    // This is a simplified check - we assume if there are trivial ones,
    // the test is suspicious
    return false
  }
  
  return true
}
