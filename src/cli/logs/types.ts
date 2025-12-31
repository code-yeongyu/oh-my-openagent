/**
 * Log level types for filtering
 */
export type LogLevel = "all" | "info" | "warn" | "error"

/**
 * Options for the logs command
 */
export interface LogsOptions {
  /** Number of lines to show (default: 50) */
  lines?: number
  /** Follow logs in real-time (tail -f style) */
  follow?: boolean
  /** Filter by log level */
  level?: LogLevel
  /** Output in JSON format */
  json?: boolean
  /** Clear the log file */
  clear?: boolean
  /** Show log file path */
  path?: boolean
}

/**
 * Parsed log entry
 */
export interface LogEntry {
  /** Timestamp of the log entry */
  timestamp: Date
  /** Log message content */
  message: string
  /** Optional JSON data attached to the log */
  data?: unknown
  /** Source component (extracted from [component-name] prefix) */
  source?: string
  /** Detected log level */
  level: LogLevel
}

/**
 * Result of log operations
 */
export interface LogsResult {
  /** Whether the operation succeeded */
  success: boolean
  /** Number of entries processed */
  count: number
  /** Error message if failed */
  error?: string
}
