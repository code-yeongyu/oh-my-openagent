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
  settingsEnabledPlugins: unknown,
  overrideEnabledPlugins: unknown,
): boolean {
  if (isEnabledPluginsRecord(overrideEnabledPlugins) && pluginKey in overrideEnabledPlugins) {
    const overrideEnabled = overrideEnabledPlugins[pluginKey]
    if (typeof overrideEnabled === "boolean") {
      return overrideEnabled
    }
  }
  if (isEnabledPluginsRecord(settingsEnabledPlugins) && pluginKey in settingsEnabledPlugins) {
    const settingsEnabled = settingsEnabledPlugins[pluginKey]
    if (typeof settingsEnabled === "boolean") {
      return settingsEnabled
    }
  }
  return true
}

function isEnabledPluginsRecord(value: unknown): value is Record<string, boolean> {
  return typeof value === "object" && value !== null
}
