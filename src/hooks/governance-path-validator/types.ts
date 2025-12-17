/**
 * Configuration for the governance path validator hook.
 * Controls how file path validation is enforced.
 */
export interface PathValidatorConfig {
  /** Whether path validation is enabled */
  enabled: boolean
  /** Validation mode: warn (log only), block (prevent), disabled (skip) */
  mode: "warn" | "block" | "disabled"
  /** List of allowed path prefixes (relative to project root) */
  allowed_paths: string[]
}

/**
 * Default configuration for path validation.
 */
export const DEFAULT_PATH_VALIDATOR_CONFIG: PathValidatorConfig = {
  enabled: true,
  mode: "warn",
  allowed_paths: [
    "context/specs/",
    "context/memory/",
    ".cursor/specs/",
    ".cursor/memory/",
    ".opencode/",
    "src/",
    "tests/",
    "docs/",
    "lib/",
    "packages/",
  ],
}

/**
 * Result of path validation.
 */
export interface PathValidationResult {
  /** Whether the path is valid */
  valid: boolean
  /** The path that was validated */
  path: string
  /** Reason for validation failure (if invalid) */
  reason?: string
  /** Suggested correct path (if available) */
  suggestion?: string
}
