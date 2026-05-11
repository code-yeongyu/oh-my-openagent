import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { SovereignError } from "./errors"

/**
 * Configuration for the logger.
 * Decoupled from the rest of the project to ensure leaf node status.
 */
export interface LoggerConfig {
  logFile: string
  flushIntervalMs?: number
  bufferSizeLimit?: number
}

let activeConfig: LoggerConfig | null = null
let buffer: string[] = []
let flushTimer: ReturnType<typeof setTimeout> | null = null

const DEFAULT_FLUSH_INTERVAL = 500
const DEFAULT_BUFFER_LIMIT = 50

/**
 * Initializes the logger with specific configuration.
 * Must be called before log() for custom behavior, otherwise defaults to temp dir.
 */
export function initializeLogger(config?: Partial<LoggerConfig>): void {
  const logFilename = "oh-my-opencode.log" // Default if constants not injected
  activeConfig = {
    logFile: config?.logFile ?? path.join(os.tmpdir(), logFilename),
    flushIntervalMs: config?.flushIntervalMs ?? DEFAULT_FLUSH_INTERVAL,
    bufferSizeLimit: config?.bufferSizeLimit ?? DEFAULT_BUFFER_LIMIT,
  }
}

function getSafeConfig(): LoggerConfig {
  if (!activeConfig) {
    initializeLogger()
  }
  return activeConfig!
}

function flush(): void {
  if (buffer.length === 0) return
  const config = getSafeConfig()
  const data = buffer.join("")
  buffer = []
  
  try {
    fs.appendFileSync(config.logFile, data)
  } catch (error) {
    // If logging fails, we fall back to console to avoid silent loss of critical errors
    // while ensuring we don't crash the main process.
    console.error(`[Sisyphus-Logger] Failed to write to ${config.logFile}:`, error)
    throw new SovereignError(
      "Failed to flush log buffer",
      "LOGGER_FLUSH_FAILURE",
      error
    )
  }
}

function scheduleFlush(): void {
  if (flushTimer) return
  const config = getSafeConfig()
  flushTimer = setTimeout(() => {
    flushTimer = null
    try {
      flush()
    } catch (e) {
      // In set timeout, we must catch to avoid unhandled rejection/exception
      // but we've already logged to console in flush()
    }
  }, config.flushIntervalMs)
}

/**
 * Primary logging utility.
 * Pure sink: does not import from high-level project files.
 */
export function log(message: string, data?: unknown): void {
  const config = getSafeConfig()
  try {
    const timestamp = new Date().toISOString()
    const logEntry = `[${timestamp}] ${message} ${data ? JSON.stringify(data) : ""}\n`
    buffer.push(logEntry)
    
    if (buffer.length >= config.bufferSizeLimit!) {
      flush()
    } else {
      scheduleFlush()
    }
  } catch (error) {
    console.error("[Sisyphus-Logger] Critical failure in log():", error)
    // No throw here to prevent logging from crashing the application logic
  }
}

export function getLogFilePath(): string {
  return getSafeConfig().logFile
}
