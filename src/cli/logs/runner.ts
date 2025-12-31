import * as fs from "fs"
import { getLogFilePath } from "../../shared/logger"
import type { LogsOptions, LogEntry } from "./types"
import { DEFAULT_LINES, FOLLOW_POLL_INTERVAL } from "./constants"
import {
  parseLogFile,
  filterByLevel,
  getLastNEntries,
  parseLogLine,
} from "./parser"
import {
  formatLogEntries,
  formatJsonOutput,
  formatPath,
  formatSuccess,
  formatError,
  formatFollowStatus,
  formatEmptyLogs,
  formatLogCount,
} from "./formatter"

/**
 * View logs (default behavior)
 */
async function viewLogs(logPath: string, options: LogsOptions): Promise<number> {
  try {
    if (!fs.existsSync(logPath)) {
      console.log(formatEmptyLogs())
      return 0
    }

    const content = fs.readFileSync(logPath, "utf-8")
    const allEntries = parseLogFile(content)

    if (allEntries.length === 0) {
      console.log(formatEmptyLogs())
      return 0
    }

    // Filter by level
    const level = options.level ?? "all"
    const filteredEntries = filterByLevel(allEntries, level)

    // Get last N entries
    const lines = options.lines ?? DEFAULT_LINES
    const entries = getLastNEntries(filteredEntries, lines)

    if (entries.length === 0) {
      console.log(formatEmptyLogs())
      return 0
    }

    // Output
    if (options.json) {
      console.log(formatJsonOutput(entries))
    } else {
      console.log(formatLogCount(entries.length, filteredEntries.length))
      console.log("")
      console.log(formatLogEntries(entries))
    }

    return 0
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error(formatError(`Failed to read logs: ${message}`))
    return 1
  }
}

/**
 * Follow logs in real-time (tail -f style)
 */
async function followLogs(logPath: string, options: LogsOptions): Promise<number> {
  console.log(formatFollowStatus(logPath))
  console.log("")

  let lastSize = 0
  let lastEntries: LogEntry[] = []

  // Initial read
  if (fs.existsSync(logPath)) {
    const content = fs.readFileSync(logPath, "utf-8")
    lastSize = Buffer.byteLength(content, "utf-8")
    lastEntries = parseLogFile(content)

    // Show last N entries initially
    const lines = options.lines ?? DEFAULT_LINES
    const level = options.level ?? "all"
    const filtered = filterByLevel(lastEntries, level)
    const initial = getLastNEntries(filtered, lines)

    if (initial.length > 0) {
      if (options.json) {
        console.log(formatJsonOutput(initial))
      } else {
        console.log(formatLogEntries(initial))
      }
    }
  }

  // Poll for changes
  const poll = () => {
    try {
      if (!fs.existsSync(logPath)) {
        return
      }

      const content = fs.readFileSync(logPath, "utf-8")
      const currentSize = Buffer.byteLength(content, "utf-8")

      if (currentSize > lastSize) {
        const allEntries = parseLogFile(content)
        const newEntries = allEntries.slice(lastEntries.length)

        if (newEntries.length > 0) {
          const level = options.level ?? "all"
          const filtered = filterByLevel(newEntries, level)

          if (filtered.length > 0) {
            if (options.json) {
              console.log(formatJsonOutput(filtered))
            } else {
              console.log(formatLogEntries(filtered))
            }
          }
        }

        lastSize = currentSize
        lastEntries = allEntries
      } else if (currentSize < lastSize) {
        // File was truncated (cleared)
        lastSize = currentSize
        lastEntries = parseLogFile(content)
      }
    } catch {
      // Ignore read errors during polling
    }
  }

  // Set up polling interval
  const intervalId = setInterval(poll, FOLLOW_POLL_INTERVAL)

  // Keep process alive until signal received
  return new Promise<number>((resolve) => {
    const cleanup = () => {
      clearInterval(intervalId)
      process.off("SIGINT", cleanup)
      process.off("SIGTERM", cleanup)
      console.log("")
      console.log(formatSuccess("Stopped following logs"))
      resolve(0)
    }

    process.on("SIGINT", cleanup)
    process.on("SIGTERM", cleanup)
  })
}

/**
 * Clear the log file
 */
async function clearLogs(logPath: string): Promise<number> {
  try {
    fs.writeFileSync(logPath, "")
    console.log(formatSuccess("Logs cleared"))
    return 0
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error(formatError(`Failed to clear logs: ${message}`))
    return 1
  }
}

/**
 * Show log file path
 */
async function showPath(logPath: string): Promise<number> {
  console.log(formatPath(logPath))
  return 0
}

/**
 * Main logs command handler
 */
export async function logs(options: LogsOptions = {}): Promise<number> {
  const logPath = getLogFilePath()

  // --path: show log file path
  if (options.path) {
    return showPath(logPath)
  }

  // --clear: clear the log file
  if (options.clear) {
    return clearLogs(logPath)
  }

  // --follow: tail -f style
  if (options.follow) {
    return followLogs(logPath, options)
  }

  // Default: view logs
  return viewLogs(logPath, options)
}
