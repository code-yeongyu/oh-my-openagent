import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"

import { canonicalAgentDir } from "./bin/lib/agent-dir.js"
import { parseJsonc } from "./bin/lib/jsonc.js"

// senpi's approval modes (permission-system/types.ts) and its default for a session nobody configured.
export const PERMISSION_PRESETS = ["full-access", "workspace", "accept-edits", "auto", "read-only", "ask"] as const
const DEFAULT_PERMISSION_PRESET = "full-access"

export const isPermissionPreset = (value: string): boolean => PERMISSION_PRESETS.some((preset) => preset === value)

/**
 * The mode a session this person starts on this device gets: the global `permissionPreset` of this device's engine
 * settings (settings.jsonc wins over settings.json, as senpi reads them), else senpi's default. `omo remote open` names
 * it, so a session started from this terminal on another device behaves as one started here (#6189).
 */
export function localPermissionPreset(agentDir: string = canonicalAgentDir()): string {
  for (const name of ["settings.jsonc", "settings.json"]) {
    const path = join(agentDir, name)
    if (!existsSync(path)) continue
    let document: unknown
    try {
      document = parseJsonc(readFileSync(path, "utf8"))
    } catch { // no-excuse-ok: catch - an unreadable settings file names no mode; the engine itself would refuse it.
      return DEFAULT_PERMISSION_PRESET
    }
    const preset = typeof document === "object" && document !== null ? (document as { readonly permissionPreset?: unknown }).permissionPreset : undefined
    return typeof preset === "string" && isPermissionPreset(preset) ? preset : DEFAULT_PERMISSION_PRESET
  }
  return DEFAULT_PERMISSION_PRESET
}
