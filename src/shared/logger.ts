import * as fs from "fs"
import * as os from "os"
import * as path from "path"

const logFile = path.join(os.tmpdir(), "oh-my-opencode.log")
let nonInteractiveMode = false

export function setNonInteractiveMode(enabled: boolean): void {
  nonInteractiveMode = enabled
}

export function log(message: string, data?: unknown, isError: boolean = false): void {
  // Suppress non-error logs in non-interactive mode
  if (nonInteractiveMode && !isError) {
    return
  }
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
