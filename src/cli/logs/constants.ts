import pc from "picocolors"

/**
 * Symbols used for log level indicators
 */
export const LOG_SYMBOLS = {
  info: pc.blue("●"),
  warn: pc.yellow("▲"),
  error: pc.red("✖"),
  all: pc.dim("○"),
} as const

/**
 * Colors for different log levels
 */
export const LOG_COLORS = {
  info: pc.blue,
  warn: pc.yellow,
  error: pc.red,
  all: pc.white,
} as const

/**
 * Default number of lines to show
 */
export const DEFAULT_LINES = 50

/**
 * Polling interval for --follow mode (ms)
 */
export const FOLLOW_POLL_INTERVAL = 500

/**
 * Keywords that indicate error-level logs
 */
export const ERROR_KEYWORDS = [
  "error",
  "failed",
  "exception",
  "crash",
  "fatal",
  "panic",
] as const

/**
 * Keywords that indicate warning-level logs
 */
export const WARN_KEYWORDS = [
  "warn",
  "warning",
  "deprecated",
  "timeout",
  "retry",
] as const
