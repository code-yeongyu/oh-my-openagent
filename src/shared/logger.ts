// Shared logging utility for the plugin

import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"

const logFile = path.join(os.tmpdir(), "matrixx.log")

export function log(message: string, data?: unknown): void {
  try {
    const timestamp = new Date().toISOString()
    const logEntry = `[${timestamp}] ${message} ${data ? JSON.stringify(data) : ""}\n`
    fs.appendFileSync(logFile, logEntry)
  } catch {
  }
}

export function getLogFilePath(): string {
  return logFile
}
