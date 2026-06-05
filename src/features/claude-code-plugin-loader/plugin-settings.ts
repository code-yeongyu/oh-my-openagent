import { existsSync, readFileSync } from "fs"
import { log } from "../../shared/logger"
import { getClaudeSettingsPath } from "./discovery-paths"
import type { ClaudeSettings } from "./types"

export function loadClaudeSettings(): ClaudeSettings | null {
  const settingsPath = getClaudeSettingsPath()
  if (!existsSync(settingsPath)) {
    return null
  }

  try {
    const content = readFileSync(settingsPath, "utf-8")
    return JSON.parse(content) as ClaudeSettings
  } catch (error) {
    if (error instanceof Error) {
      log("Failed to load Claude settings", error)
      return null
    }
    throw error
  }
}

export function isPluginEnabled(
  pluginKey: string,
  settingsEnabledPlugins: Record<string, boolean> | undefined,
  overrideEnabledPlugins: Record<string, boolean> | undefined,
): boolean {
  if (overrideEnabledPlugins && pluginKey in overrideEnabledPlugins) {
    return overrideEnabledPlugins[pluginKey]
  }
  if (settingsEnabledPlugins && pluginKey in settingsEnabledPlugins) {
    return settingsEnabledPlugins[pluginKey]
  }
  return true
}
