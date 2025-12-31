import pc from "picocolors"
import type { LogEntry, LogLevel, LogLevelFilter } from "./types"
import { LOG_SYMBOLS, LOG_COLORS } from "./constants"

/**
 * Format a timestamp for display
 */
function formatTimestamp(date: Date): string {
  const hours = date.getHours().toString().padStart(2, "0")
  const minutes = date.getMinutes().toString().padStart(2, "0")
  const seconds = date.getSeconds().toString().padStart(2, "0")
  return pc.dim(`${hours}:${minutes}:${seconds}`)
}

/**
 * Format a single log entry for console output
 */
export function formatLogEntry(entry: LogEntry): string {
  const symbol = LOG_SYMBOLS[entry.level]
  const color = LOG_COLORS[entry.level]
  const timestamp = formatTimestamp(entry.timestamp)

  let output = `${timestamp} ${symbol} `

  if (entry.source) {
    output += pc.cyan(`[${entry.source}] `)
  }

  output += color(entry.message)

  if (entry.data) {
    const dataStr = JSON.stringify(entry.data, null, 2)
    output += "\n" + pc.dim(dataStr)
  }

  return output
}

/**
 * Format multiple log entries for console output
 */
export function formatLogEntries(entries: LogEntry[]): string {
  return entries.map(formatLogEntry).join("\n")
}

/**
 * Format log entries as JSON output
 */
export function formatJsonOutput(entries: LogEntry[]): string {
  const jsonEntries = entries.map((entry) => ({
    timestamp: entry.timestamp.toISOString(),
    level: entry.level,
    source: entry.source ?? null,
    message: entry.message,
    data: entry.data ?? null,
  }))
  return JSON.stringify(jsonEntries, null, 2)
}

/**
 * Format the log file path for display
 */
export function formatPath(path: string): string {
  return pc.cyan(path)
}

/**
 * Format a success message
 */
export function formatSuccess(message: string): string {
  return pc.green("✓") + " " + message
}

/**
 * Format an error message
 */
export function formatError(message: string): string {
  return pc.red("✖") + " " + message
}

/**
 * Format an info message
 */
export function formatInfo(message: string): string {
  return pc.blue("ℹ") + " " + message
}

/**
 * Format a header line
 */
export function formatHeader(title: string): string {
  return pc.bold(pc.underline(title))
}

/**
 * Format the "following" status message
 */
export function formatFollowStatus(path: string): string {
  return pc.dim(`Following ${path}... (Ctrl+C to stop)`)
}

/**
 * Format log level for help text
 */
export function formatLevelHelp(level: LogLevelFilter): string {
  const symbol = LOG_SYMBOLS[level]
  const color = LOG_COLORS[level]
  return `${symbol} ${color(level)}`
}

/**
 * Format empty logs message
 */
export function formatEmptyLogs(): string {
  return pc.dim("No log entries found")
}

/**
 * Format log count summary
 */
export function formatLogCount(count: number, total: number): string {
  const entryWord = count === 1 ? "entry" : "entries"
  const totalWord = total === 1 ? "entry" : "entries"
  if (count === total) {
    return pc.dim(`Showing all ${count} ${entryWord}`)
  }
  return pc.dim(`Showing last ${count} ${entryWord} of ${total} ${totalWord}`)
}
