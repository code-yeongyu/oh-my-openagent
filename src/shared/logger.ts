// Shared logging utility for the plugin
//
// RATIONALE: logging is used extensively across startup and tool pipelines.
// Synchronous fs writes can noticeably slow startup and per-call latency.
// This logger batches writes and flushes asynchronously, with a best-effort
// synchronous flush on process exit.

import * as fs from "node:fs"
import { appendFile } from "node:fs/promises"
import * as os from "node:os"
import * as path from "node:path"

const logFile = path.join(os.tmpdir(), "oh-my-opencode.log")

const FLUSH_INTERVAL_MS = 50
const MAX_BUFFER_BYTES = 64 * 1024

let buffer = ""
let flushTimer: ReturnType<typeof setTimeout> | null = null
let flushing = false

function scheduleFlush(): void {
  if (flushTimer) return
  flushTimer = setTimeout(() => {
    flushTimer = null
    void flushAsync()
  }, FLUSH_INTERVAL_MS)
}

async function flushAsync(): Promise<void> {
  if (flushing) return
  if (!buffer) return
  const data = buffer
  buffer = ""
  flushing = true
  try {
    await appendFile(logFile, data)
  } catch {
    // ignore
  } finally {
    flushing = false
    if (buffer) scheduleFlush()
  }
}

function flushSync(): void {
  if (!buffer) return
  try {
    fs.appendFileSync(logFile, buffer)
  } catch {
    // ignore
  } finally {
    buffer = ""
  }
}

// Best-effort flush on exit.
process.on("beforeExit", flushSync)
process.on("exit", flushSync)

export function log(message: string, data?: unknown): void {
  try {
    const timestamp = new Date().toISOString()
    const logEntry = `[${timestamp}] ${message} ${data ? JSON.stringify(data) : ""}\n`
    buffer += logEntry
    if (buffer.length >= MAX_BUFFER_BYTES) {
      void flushAsync()
      return
    }
    scheduleFlush()
  } catch {
    // ignore
  }
}

export function getLogFilePath(): string {
  return logFile
}
