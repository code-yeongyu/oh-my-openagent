import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs"
import { dirname } from "node:path"

import type { RunCommand } from "../install.ts"
import type { ServicePlatform } from "./service-table.ts"

/** Where and how the cold-wake unit is installed: this user's home and uid, the command runner and a retry pause. */
export type ColdWakeHost = {
  readonly platform: ServicePlatform
  readonly home: string
  readonly uid: number
  readonly run: RunCommand
  readonly pause: (milliseconds: number) => Promise<void>
}

/** `serviceRestarted`: the device service was restarted (or its job reloaded) because its table changed. */
export type ColdWakeOutcome =
  | { readonly kind: "installed" | "removed"; readonly serviceRestarted: boolean }
  | { readonly kind: "unsupported" }
  | { readonly kind: "service_not_installed" }
  | { readonly kind: "table_invalid"; readonly reason: string }
  | { readonly kind: "failed"; readonly step: string; readonly detail: string }

export const failed = (step: string, output: string): ColdWakeOutcome => ({
  kind: "failed",
  step,
  detail: output.trim().split(/\r?\n/)[0] ?? "",
})

const UNIT_MODE = 0o644

// Unchanged content used to return without touching the file, so the mode repair must not turn a unit this user cannot
// chmod (another owner's, a read-only filesystem) into a failed install; any other error is still raised.
const UNREPAIRABLE = new Set(["EPERM", "EACCES", "EROFS"])

const repairMode = (path: string): void => {
  if ((statSync(path).mode & 0o777) === UNIT_MODE) return
  try {
    chmodSync(path, UNIT_MODE)
  } catch (error) {
    if (!(error instanceof Error && "code" in error && UNREPAIRABLE.has(String(error.code)))) throw error
  }
}

/**
 * Writes `text` through a temp file and a rename, mode 0644: a service manager refuses a group-writable unit. The mode is
 * set by chmod before the rename because a creation mode is ANDed with ~umask (umask 077 would leave 0600). An unchanged
 * file still gets its mode repaired (a unit an older build wrote 0600, omo#14247) without counting as a change.
 */
export const writeIfChanged = (path: string, text: string): boolean => {
  if (existsSync(path) && readFileSync(path, "utf8") === text) {
    repairMode(path)
    return false
  }
  mkdirSync(dirname(path), { recursive: true })
  const temp = `${path}.${process.pid}.tmp`
  writeFileSync(temp, text, { mode: UNIT_MODE })
  chmodSync(temp, UNIT_MODE)
  renameSync(temp, path)
  return true
}

export const removeIfPresent = (path: string): boolean => {
  if (!existsSync(path)) return false
  rmSync(path)
  return true
}
