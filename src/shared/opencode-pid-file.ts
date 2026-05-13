import { mkdirSync, unlinkSync, readFileSync, writeFileSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { log } from "./logger"

const DEFAULT_PID_FILE_PATH = path.join(os.homedir(), ".local/share/opencode/server.pid")

/**
 * Returns the PID file path. Overridable via OPENCODE_PID_FILE env var for
 * testing (avoids touching the real home directory in tests).
 */
export function getPidFilePath(): string {
  return process.env["OPENCODE_PID_FILE"] ?? DEFAULT_PID_FILE_PATH
}

export type PidFileContents = {
  pid: number
  serverUrl: string
  writtenAt: string
}

/**
 * Writes a PID file recording the current opencode server's URL and process
 * ID.  Creates parent directories as needed.  Call once at startup after the
 * server URL is known.
 */
export function writeOpencodePidFile(serverUrl: string, pid: number = process.pid): void {
  const filePath = getPidFilePath()
  const dir = path.dirname(filePath)
  mkdirSync(dir, { recursive: true })
  const contents: PidFileContents = {
    pid,
    serverUrl,
    writtenAt: new Date().toISOString(),
  }
  writeFileSync(filePath, JSON.stringify(contents, null, 2) + "\n", "utf8")
  log("[opencode-pid-file] written", { pid, serverUrl, path: filePath })
}

/**
 * Removes the PID file.  Ignores ENOENT (idempotent).  Call from a
 * beforeExit / dispose handler so stale entries do not linger.
 */
export function clearOpencodePidFile(): void {
  const filePath = getPidFilePath()
  try {
    unlinkSync(filePath)
    log("[opencode-pid-file] cleared", { path: filePath })
  } catch (error) {
    const nodeError = error as NodeJS.ErrnoException
    if (nodeError.code === "ENOENT") return
    log("[opencode-pid-file] clear failed", { path: filePath, error: String(error) })
  }
}

let exitCleanupRegistered = false

/**
 * Registers cleanup handlers so the PID file is removed when the process
 * exits — covers natural exit, `process.exit()`, SIGINT, SIGTERM, and SIGHUP.
 * `beforeExit` alone is insufficient because it does not fire when the host
 * calls `process.exit()` directly (which opencode does for short commands
 * like `agent list`). Safe to call multiple times; only the first call
 * installs handlers.
 */
export function registerOpencodePidFileCleanup(): void {
  if (exitCleanupRegistered) return
  exitCleanupRegistered = true

  process.once("exit", clearOpencodePidFile)
  process.once("beforeExit", clearOpencodePidFile)
  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
    process.once(signal, () => {
      clearOpencodePidFile()
      // Re-raise so the host's own handler (or default action) still fires.
      process.kill(process.pid, signal)
    })
  }
}

/**
 * Reads and parses the PID file.  Returns null when the file is absent,
 * unreadable, or structurally invalid.
 */
export function readOpencodePidFile(): PidFileContents | null {
  const filePath = getPidFilePath()
  try {
    const raw = readFileSync(filePath, "utf8")
    const parsed = JSON.parse(raw) as unknown
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      typeof (parsed as Record<string, unknown>)["pid"] === "number" &&
      typeof (parsed as Record<string, unknown>)["serverUrl"] === "string" &&
      typeof (parsed as Record<string, unknown>)["writtenAt"] === "string"
    ) {
      return parsed as PidFileContents
    }
    return null
  } catch {
    return null
  }
}

/**
 * Checks whether a process with the given PID is still running.
 * Uses signal 0 (existence probe): ESRCH → not alive; EPERM → alive (no
 * permission to signal); anything else → conservatively false.
 */
export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    const nodeError = error as NodeJS.ErrnoException
    if (nodeError.code === "ESRCH") return false
    if (nodeError.code === "EPERM") return true
    return false
  }
}
