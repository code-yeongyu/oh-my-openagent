/**
 * TDD Guard Hook Constants
 *
 * File patterns for Risk Tier classification.
 */

import type { TddGuardConfig, TestFilePattern, SupportedLanguage } from "./types"

/**
 * Default configuration for TDD Guard
 */
export const DEFAULT_TDD_GUARD_CONFIG: TddGuardConfig = {
  enabled: false,
  risk_tier_enabled: true,
  min_enforce_tier: 2,
  ignore_patterns: ["*.md", "*.json", "*.yaml", "*.css"],
  reject_empty_tests: true,
  reject_missing_assertions: true,
  reject_trivial_assertions: true,
  inject_skill_on_block: true,
  enable_real_test_execution: false, // Disabled by default for safety
  test_timeout_ms: 30_000,
}

/**
 * Tier 0: Always allowed (documentation, config)
 */
export const TIER_0_PATTERNS: RegExp[] = [
  /\.md$/i,
  /\.txt$/i,
  /\.gitignore$/i,
  /\.editorconfig$/i,
  /README/i,
  /LICENSE/i,
  /CHANGELOG/i,
]

/**
 * Tier 1: Allowed with logging (styles, config files)
 */
export const TIER_1_PATTERNS: RegExp[] = [
  /\.css$/i,
  /\.scss$/i,
  /\.less$/i,
  /\.json$/i,
  /\.yaml$/i,
  /\.yml$/i,
  /\.toml$/i,
]

/**
 * Tier 3: Strict TDD required (core business logic)
 */
export const TIER_3_PATTERNS: RegExp[] = [
  /\/api\//i,
  /\/routes\//i,
  /\/controllers\//i,
  /\/services\//i,
  /\/models\//i,
  /\/db\//i,
  /\/database\//i,
  /\/auth\//i,
  /\/security\//i,
]

/**
 * Language-specific test file patterns
 */
export const LANGUAGE_PATTERNS: Record<SupportedLanguage, TestFilePattern> = {
  typescript: {
    extension: [".ts", ".tsx"],
    testPatterns: [/\.test\.tsx?$/, /\.spec\.tsx?$/, /__tests__\/.+\.tsx?$/],
    assertionPatterns: [/expect\s*\(/, /assert\s*\(/, /\.toBe\(/, /\.toEqual\(/],
  },
  javascript: {
    extension: [".js", ".jsx", ".mjs", ".cjs"],
    testPatterns: [/\.test\.jsx?$/, /\.spec\.jsx?$/, /__tests__\/.+\.jsx?$/],
    assertionPatterns: [/expect\s*\(/, /assert\s*\(/, /\.toBe\(/, /\.toEqual\(/],
  },
  python: {
    extension: [".py"],
    testPatterns: [/^test_.+\.py$/, /_test\.py$/, /tests\/.+\.py$/],
    assertionPatterns: [/assert /, /self\.assert/, /pytest\.raises/],
  },
  go: {
    extension: [".go"],
    testPatterns: [/_test\.go$/],
    assertionPatterns: [/t\.Error/, /t\.Errorf/, /t\.Fatal/, /t\.Fatalf/, /require\./, /assert\./, /is\./],
  },
  rust: {
    extension: [".rs"],
    testPatterns: [/#\[cfg\(test\)\]/, /#\[test\]/],
    assertionPatterns: [/assert!/, /assert_eq!/, /assert_ne!/, /panic!/],
  },
  unknown: {
    extension: [],
    testPatterns: [],
    assertionPatterns: [],
  },
}

/**
 * Trivial assertions that should be rejected
 */
export const TRIVIAL_ASSERTIONS: RegExp[] = [
  /expect\s*\(\s*true\s*\)\s*\.toBe\s*\(\s*true\s*\)/,
  /expect\s*\(\s*false\s*\)\s*\.toBe\s*\(\s*false\s*\)/,
  /expect\s*\(\s*1\s*\)\s*\.toBe\s*\(\s*1\s*\)/,
  /expect\s*\(\s*['"].*['"]\s*\)\s*\.toBe\s*\(\s*['"].*['"]\s*\)/,
  /assert\s+True\b/,
  /assert\s+False\b/,
]

/**
 * TDD-EXEMPT comment patterns
 */
export const EXEMPTION_PATTERNS: RegExp[] = [
  /<!--\s*TDD-EXEMPT\s*(?::\s*reason\s*=\s*["']([^"']+)["'])?\s*-->/i,
  /\/\/\s*TDD-EXEMPT\s*(?::\s*reason\s*=\s*["']([^"']+)["'])?/i,
  /\/\*\s*TDD-EXEMPT\s*(?::\s*reason\s*=\s*["']([^"']+)["'])?\s*\*\//i,
  /#\s*TDD-EXEMPT\s*(?::\s*reason\s*=\s*["']([^"']+)["'])?/i,
]
