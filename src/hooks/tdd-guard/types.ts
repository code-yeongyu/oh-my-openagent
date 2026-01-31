/**
 * TDD Guard Hook Types
 *
 * Defines Risk Tier levels and configuration for TDD enforcement.
 */

export type RiskTier = 0 | 1 | 2 | 3

export interface RiskTierResult {
  tier: RiskTier
  requiresTest: boolean
  allowsExemption: boolean
  description: string
}

export interface TddGuardConfig {
  /** Enable TDD Guard Hook (default: false) */
  enabled: boolean
  /** Enable Risk Tier based validation (default: true) */
  risk_tier_enabled: boolean
  /** Minimum tier to enforce TDD (default: 2) */
  min_enforce_tier: RiskTier
  /** Glob patterns to ignore (default: ["*.md", "*.json", "*.yaml", "*.css"]) */
  ignore_patterns: string[]
  /** Reject tests with empty body (default: true) */
  reject_empty_tests: boolean
  /** Reject tests without assertions (default: true) */
  reject_missing_assertions: boolean
  /** Reject trivial assertions like expect(true).toBe(true) (default: true) */
  reject_trivial_assertions: boolean
  /** Inject TDD Skill when edit is blocked (default: true) */
  inject_skill_on_block: boolean
  /** Enable real test execution to verify failing tests (default: false for safety) */
  enable_real_test_execution: boolean
  /** Timeout for test execution in milliseconds (default: 30000) */
  test_timeout_ms: number
}

export type SupportedLanguage = "typescript" | "javascript" | "python" | "go" | "rust" | "unknown"

export interface TestFilePattern {
  extension: string[]
  testPatterns: RegExp[]
  assertionPatterns: RegExp[]
}

export interface TestQualityResult {
  ok: boolean
  errors: string[]
  warnings: string[]
}

export interface TestQualityOptions {
  rejectEmptyTests: boolean
  rejectMissingAssertions: boolean
  rejectTrivialAssertions: boolean
}

export interface BlockResult {
  blocked: boolean
  reason?: string
}

/**
 * Result of running tests to check for failing tests
 */
export interface TestExecutionResult {
  /** Whether there are failing tests */
  hasFailingTests: boolean
  /** Whether the execution timed out */
  timedOut: boolean
  /** Whether no tests were found */
  noTestsFound: boolean
  /** Error message if execution failed */
  error?: string
  /** Execution time in milliseconds */
  executionTimeMs?: number
}

/**
 * Configuration for test execution
 */
export interface TestExecutionConfig {
  /** Timeout in milliseconds (default: 30000) */
  timeoutMs: number
  /** Test command to run (default: auto-detect) */
  testCommand?: string
  /** Working directory */
  cwd: string
  /** Whether to enable real test execution (default: false for safety) */
  enableRealExecution: boolean
}
