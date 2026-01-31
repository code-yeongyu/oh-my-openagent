/**
 * Secret Scanner Hook Types
 *
 * Defines types for sensitive information detection.
 */

export interface SecretScannerConfig {
  /** Enable secret scanner (default: true) */
  enabled: boolean
  /** Paths to whitelist (glob patterns) */
  whitelist_paths: string[]
  /** Whether to block on detection (default: true, false = warn only) */
  block_on_detection: boolean
  /** Severity levels to block (default: ["high", "critical"]) */
  block_severity_levels: SecretSeverity[]
}

export type SecretSeverity = "low" | "medium" | "high" | "critical"

export interface SecretPattern {
  /** Pattern name for identification */
  name: string
  /** Regular expression to match */
  pattern: RegExp
  /** Severity level */
  severity: SecretSeverity
  /** Description for error message */
  description: string
}

export interface SecretMatch {
  /** Pattern that matched */
  pattern: SecretPattern
  /** The matched text (redacted) */
  matchedText: string
  /** Line number (1-indexed) */
  lineNumber: number
}

export interface ScanResult {
  /** Whether secrets were found */
  hasSecrets: boolean
  /** List of matches */
  matches: SecretMatch[]
  /** Whether to block the operation */
  shouldBlock: boolean
  /** Human-readable message */
  message?: string
}
