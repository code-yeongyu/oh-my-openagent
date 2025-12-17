/**
 * Configuration for the governance historian hook.
 */
export interface HistorianConfig {
  /** Whether historian tracking is enabled */
  enabled: boolean
  /** Whether to auto-create changelog entries on session end */
  auto_create: boolean
  /** Path to changelog directory (relative to project root) */
  changelog_path: string
  /** Minimum number of file changes to trigger changelog creation */
  min_changes: number
}

/**
 * Default configuration for historian.
 */
export const DEFAULT_HISTORIAN_CONFIG: HistorianConfig = {
  enabled: true,
  auto_create: true,
  changelog_path: "changelog/",
  min_changes: 1,
}

/**
 * Tracks state for a single session.
 */
export interface SessionState {
  /** Files modified during this session */
  modifiedFiles: Set<string>
  /** Files created during this session */
  createdFiles: Set<string>
  /** Agent name (if detected) */
  agent?: string
  /** Session start time */
  startTime: Date
  /** Session ID */
  sessionId: string
}

/**
 * File change entry for changelog.
 */
export interface FileChange {
  /** File path (relative to project root) */
  path: string
  /** Type of change */
  type: "created" | "modified" | "deleted"
  /** Timestamp of change */
  timestamp: Date
}

/**
 * Changelog entry structure.
 */
export interface ChangelogEntry {
  /** Date of the changelog entry */
  date: string
  /** Agent that performed the work */
  agent: string
  /** Scope/feature being worked on */
  scope: string
  /** Session ID */
  sessionId: string
  /** Summary of changes */
  summary: string
  /** List of file changes */
  files: FileChange[]
}
