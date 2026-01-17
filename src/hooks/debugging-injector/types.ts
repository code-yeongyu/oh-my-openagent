/**
 * Debugging Injector Hook Types
 *
 * Tracks fix attempts and injects systematic-debugging skill when ≥2 failures.
 */

export interface DebugInjectorConfig {
  /** Enable debugging injector hook (default: false) */
  enabled: boolean
  /** Number of failures before injecting debugging skill (default: 2) */
  failure_threshold: number
  /** Inject systematic-debugging skill when threshold reached (default: true) */
  inject_skill_on_threshold: boolean
  /** Reset failure count after successful fix (default: true) */
  reset_on_success: boolean
  /** Time window in milliseconds to track failures (default: 30 minutes) */
  failure_window_ms: number
}

export interface FailureRecord {
  filePath: string
  timestamp: number
  errorMessage?: string
}

export interface DebugInjectorState {
  /** Map of file path to failure records */
  failures: Map<string, FailureRecord[]>
  /** Set of files that have received debugging skill injection */
  injectedFiles: Set<string>
}
