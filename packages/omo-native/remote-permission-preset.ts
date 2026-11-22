import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"

import { canonicalAgentDir } from "./bin/lib/agent-dir.js"
import { parseJsonc } from "./bin/lib/jsonc.js"
import { UsageError } from "./remote-exit"

import { isPermissionPreset, PERMISSION_PRESETS } from "../omo-senpi/src/components/thread/contracts/permission-presets"

export { isPermissionPreset, PERMISSION_PRESETS }

// senpi's default approval mode for a session nobody configured.
const DEFAULT_PERMISSION_PRESET = "full-access"

/**
 * The mode a session this person starts on this device gets: the global `permissionPreset` of this device's engine
 * settings (settings.jsonc wins over settings.json, as senpi reads them), else senpi's default. `omo remote open` names
 * it, so a session started from this terminal on another device behaves as one started here (#6189). A settings file
 * that does not parse, or names a mode this build does not know, is a usage error: it never falls back to the loosest mode.
 */
export function localPermissionPreset(agentDir: string = canonicalAgentDir()): string {
  for (const name of ["settings.jsonc", "settings.json"]) {
    const path = join(agentDir, name)
    if (!existsSync(path)) continue
    let document: unknown
    try {
      document = parseJsonc(readFileSync(path, "utf8"))
    } catch (error) {
      throw new UsageError(
        `omo remote open: ${path} could not be read (${error instanceof Error ? error.message : String(error)}); pass --permission-preset`,
      )
    }
    const preset =
      typeof document === "object" && document !== null
        ? (document as { readonly permissionPreset?: unknown }).permissionPreset
        : undefined
    if (preset === undefined) return DEFAULT_PERMISSION_PRESET
    if (typeof preset === "string" && isPermissionPreset(preset)) return preset
    throw new UsageError(
      `omo remote open: ${path} names permissionPreset ${JSON.stringify(preset)}, which is not one of ${PERMISSION_PRESETS.join(", ")}; pass --permission-preset`,
    )
  }
  return DEFAULT_PERMISSION_PRESET
}
