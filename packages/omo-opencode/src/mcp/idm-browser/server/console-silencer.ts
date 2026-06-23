import { appendFileSync, mkdirSync } from "node:fs"
import { dirname } from "node:path"

let consoleSilenced = false

function safeStringify(v: unknown): string {
  try {
    return JSON.stringify(v)
  } catch {
    return String(v)
  }
}

export function silenceConsoleToFile(logPath: string): void {
  if (consoleSilenced) return
  consoleSilenced = true

  mkdirSync(dirname(logPath), { recursive: true })

  const writeToLog = (level: string, args: unknown[]): void => {
    const timestamp = new Date().toISOString()
    const message = args
      .map((a) => (typeof a === "string" ? a : safeStringify(a)))
      .join(" ")
    try {
      appendFileSync(logPath, `[${timestamp}] ${level} ${message}\n`)
    } catch {
      void 0
    }
  }

  console.log = (...a: unknown[]) => writeToLog("log", a)
  console.warn = (...a: unknown[]) => writeToLog("warn", a)
  console.error = (...a: unknown[]) => writeToLog("error", a)
  console.info = (...a: unknown[]) => writeToLog("info", a)
  console.debug = (...a: unknown[]) => writeToLog("debug", a)
}

export function appendServerLog(logPath: string, level: string, payload: unknown): void {
  try {
    appendFileSync(logPath, `[${new Date().toISOString()}] ${level} ${safeStringify(payload)}\n`)
  } catch {
    void 0
  }
}
