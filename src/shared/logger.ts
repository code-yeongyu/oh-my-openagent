import * as fs from "fs"
import * as os from "os"
import * as path from "path"

const logFile = path.join(os.tmpdir(), "oh-my-opencode.log")

let buffer: string[] = []
let flushTimer: ReturnType<typeof setTimeout> | null = null
const FLUSH_INTERVAL_MS = 500
const BUFFER_SIZE_LIMIT = 50

function flush(): void {
  if (buffer.length === 0) return
  const data = buffer.join("")
  buffer = []
  try {
    fs.appendFileSync(logFile, data)
  } catch {
  }
}

function scheduleFlush(): void {
  if (flushTimer) return
  flushTimer = setTimeout(() => {
    flushTimer = null
    flush()
  }, FLUSH_INTERVAL_MS)
}

export function log(message: string, data?: unknown): void {
  try {
    const timestamp = new Date().toISOString()
    const logEntry = `[${timestamp}] ${message} ${data ? JSON.stringify(data) : ""}\n`
    buffer.push(logEntry)
    if (buffer.length >= BUFFER_SIZE_LIMIT) {
      flush()
    } else {
      scheduleFlush()
    }
  } catch {
  }
}

export function getLogFilePath(): string {
  return logFile
}
