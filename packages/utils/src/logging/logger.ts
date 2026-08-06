import * as fs from "fs"
import * as os from "os"
import * as path from "path"

export const DEFAULT_MAX_LOG_FILE_SIZE_BYTES = 50 * 1024 * 1024
export const DEFAULT_MAX_LOG_FILE_BACKUPS = 2
export const DEFAULT_LOG_FLUSH_INTERVAL_MS = 500
export const DEFAULT_LOG_BUFFER_SIZE_LIMIT = 50

export type LoggerTestOverrides = {
  readonly filePath?: string
  readonly maxSizeBytes?: number
  readonly maxBackups?: number
}

export type LoggerOptions = {
  readonly logFileName: string
  readonly maxSizeBytes?: number
  readonly maxBackups?: number
  readonly flushIntervalMs?: number
  readonly bufferSizeLimit?: number
  readonly resolveLogFilePath?: (logFileName: string) => string
}

export type BoundLogger = {
  readonly log: (message: string, data?: unknown) => void
  readonly getLogFilePath: () => string
  readonly _setLoggerForTesting: (overrides: LoggerTestOverrides) => void
  readonly _resetLoggerForTesting: () => void
  readonly _flushForTesting: () => void
}

function defaultLogFilePath(logFileName: string): string {
  return path.join(os.tmpdir(), logFileName)
}

export function createLogger(options: LoggerOptions): BoundLogger {
  const maxLogFileSizeDefault = options.maxSizeBytes ?? DEFAULT_MAX_LOG_FILE_SIZE_BYTES
  const maxLogFileBackupsDefault = options.maxBackups ?? DEFAULT_MAX_LOG_FILE_BACKUPS
  const flushIntervalMs = options.flushIntervalMs ?? DEFAULT_LOG_FLUSH_INTERVAL_MS
  const bufferSizeLimit = options.bufferSizeLimit ?? DEFAULT_LOG_BUFFER_SIZE_LIMIT
  const resolveLogFilePath = options.resolveLogFilePath ?? defaultLogFilePath
  const initialLogFile = resolveLogFilePath(options.logFileName)

  let logFile = initialLogFile
  let maxLogFileSizeBytes = maxLogFileSizeDefault
  let maxLogFileBackups = maxLogFileBackupsDefault
  let buffer: string[] = []
  let flushTimer: ReturnType<typeof setTimeout> | null = null

  function rotateLogFileIfNeeded(): void {
    try {
      if (!fs.existsSync(logFile)) return
      const stats = fs.statSync(logFile)
      if (stats.size <= maxLogFileSizeBytes) return

      const oldest = `${logFile}.${maxLogFileBackups}`
      if (fs.existsSync(oldest)) {
        fs.unlinkSync(oldest)
      }
      for (let i = maxLogFileBackups - 1; i >= 1; i -= 1) {
        const src = `${logFile}.${i}`
        const dst = `${logFile}.${i + 1}`
        if (fs.existsSync(src)) {
          fs.renameSync(src, dst)
        }
      }
      fs.renameSync(logFile, `${logFile}.1`)
    } catch (error) {
      if (error instanceof Error) return
    }
  }

  function flush(): void {
    if (buffer.length === 0) return
    const data = buffer.join("")
    buffer = []
    try {
      fs.appendFileSync(logFile, data)
      rotateLogFileIfNeeded()
    } catch (error) {
      if (error instanceof Error) return
    }
  }

  function scheduleFlush(): void {
    if (flushTimer) return
    flushTimer = setTimeout(() => {
      flushTimer = null
      flush()
    }, flushIntervalMs)
  }

  function log(message: string, data?: unknown): void {
    try {
      const timestamp = new Date().toISOString()
      const logEntry = `[${timestamp}] ${message} ${data ? JSON.stringify(data) : ""}\n`
      buffer.push(logEntry)
      if (buffer.length >= bufferSizeLimit) {
        flush()
      } else {
        scheduleFlush()
      }
    } catch (error) {
      if (error instanceof Error) return
    }
  }

  function getLogFilePath(): string {
    return logFile
  }

  function _setLoggerForTesting(overrides: LoggerTestOverrides): void {
    buffer = []
    if (flushTimer) {
      clearTimeout(flushTimer)
      flushTimer = null
    }
    if (overrides.filePath !== undefined) logFile = overrides.filePath
    if (overrides.maxSizeBytes !== undefined) maxLogFileSizeBytes = overrides.maxSizeBytes
    if (overrides.maxBackups !== undefined) maxLogFileBackups = overrides.maxBackups
  }

  function _resetLoggerForTesting(): void {
    logFile = initialLogFile
    maxLogFileSizeBytes = maxLogFileSizeDefault
    maxLogFileBackups = maxLogFileBackupsDefault
    buffer = []
    if (flushTimer) {
      clearTimeout(flushTimer)
      flushTimer = null
    }
  }

  function _flushForTesting(): void {
    if (flushTimer) {
      clearTimeout(flushTimer)
      flushTimer = null
    }
    flush()
  }

  return {
    log,
    getLogFilePath,
    _setLoggerForTesting,
    _resetLoggerForTesting,
    _flushForTesting,
  }
}
