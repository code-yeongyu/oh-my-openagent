import { existsSync, readFileSync, writeFileSync } from "node:fs"

import { log } from "./logger"
import { LEGACY_PLUGIN_NAME, PLUGIN_NAME } from "./plugin-identity"

export function migrateLegacyPluginEntry(configPath: string): boolean {
  if (!existsSync(configPath)) return false

  try {
    const content = readFileSync(configPath, "utf-8")
    if (!content.includes(LEGACY_PLUGIN_NAME)) return false

    const updated = content.replaceAll(LEGACY_PLUGIN_NAME, PLUGIN_NAME)
    if (updated === content) return false

    writeFileSync(configPath, updated, "utf-8")
    log("[migrateLegacyPluginEntry] Auto-migrated opencode.json plugin entry", {
      configPath,
      from: LEGACY_PLUGIN_NAME,
      to: PLUGIN_NAME,
    })
    return true
  } catch (error) {
    log("[migrateLegacyPluginEntry] Failed to migrate opencode.json", { configPath, error })
    return false
  }
}
