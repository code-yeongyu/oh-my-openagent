/**
 * Configuration for the governance Linear injector hook.
 */
export interface LinearInjectorConfig {
  /** Whether Linear context injection is enabled */
  enabled: boolean
  /** Team prefix pattern for issue detection (e.g., "LIF") */
  team_prefix: string
  /** Whether to cache issue data per session */
  cache_issues: boolean
}

/**
 * Default configuration for Linear injector.
 */
export const DEFAULT_LINEAR_INJECTOR_CONFIG: LinearInjectorConfig = {
  enabled: true,
  team_prefix: "LIF",
  cache_issues: true,
}

/**
 * Linear issue context that gets injected into prompts.
 */
export interface LinearIssueContext {
  /** Issue ID (UUID) */
  id: string
  /** Issue identifier (e.g., LIF-123) */
  identifier: string
  /** Issue title */
  title: string
  /** Issue status */
  status: string
  /** Issue description (truncated) */
  description?: string
  /** Branch name from Linear */
  branchName?: string
  /** Issue URL */
  url: string
  /** Parent issue identifier (if sub-issue) */
  parentIdentifier?: string
  /** Labels */
  labels?: string[]
}

/**
 * Cached issue data for a session.
 */
export interface SessionIssueCache {
  /** Map of issue identifier to context */
  issues: Map<string, LinearIssueContext>
  /** Identifiers that have been injected */
  injectedIdentifiers: Set<string>
}
