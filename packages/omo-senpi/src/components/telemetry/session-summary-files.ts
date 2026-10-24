import { mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs"
import { dirname } from "node:path"

// Every write is a temp file renamed over the target, so a reader (or a process killed mid-write) sees
// either the previous complete file or the new complete file, never a torn one.
export function writeJsonAtomic(path: string, value: unknown, owner: { readonly pid: number; readonly bootId: string }): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
  const temp = `${path}.${owner.pid}-${owner.bootId}.tmp`
  writeFileSync(temp, JSON.stringify(value), { mode: 0o600 })
  renameSync(temp, path)
}

// Registered, so the recovery sidecar bundle and the entry bundle share one marker for unreadable files.
export const CORRUPT: unique symbol = Symbol.for("omo-senpi.session-summary.corrupt")

export function readJsonOrCorrupt(path: string): unknown {
  let text: string
  try {
    text = readFileSync(path, "utf8")
  } catch {
    return undefined
  }
  try {
    return JSON.parse(text)
  } catch {
    return CORRUPT
  }
}

export function readJson(path: string): unknown {
  const value = readJsonOrCorrupt(path)
  return value === CORRUPT ? undefined : value
}

export function removeFile(path: string): void {
  rmSync(path, { force: true })
}

export function listNames(dir: string): readonly string[] {
  try {
    return readdirSync(dir)
  } catch {
    return []
  }
}

/** Atomic hand-over: exactly one of several racing renames of the same source succeeds. */
export function renameIfPresent(from: string, to: string): boolean {
  try {
    renameSync(from, to)
    return true
  } catch {
    return false
  }
}
