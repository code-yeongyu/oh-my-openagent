import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs"
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

/** Writes `text` through a temp file and a rename (mode 0644: a service manager refuses a group-writable unit). */
export const writeIfChanged = (path: string, text: string): boolean => {
  if (existsSync(path) && readFileSync(path, "utf8") === text) return false
  mkdirSync(dirname(path), { recursive: true })
  const temp = `${path}.${process.pid}.tmp`
  writeFileSync(temp, text, { mode: 0o644 })
  renameSync(temp, path)
  return true
}

export const removeIfPresent = (path: string): boolean => {
  if (!existsSync(path)) return false
  rmSync(path)
  return true
}
