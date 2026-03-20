import { existsSync, readFileSync } from "node:fs"

import { LEGACY_PLUGIN_NAME, PLUGIN_NAME, getOpenCodeConfigPaths, parseJsonc } from "../../../shared"

export interface PluginInfo {
  registered: boolean
  configPath: string | null
  entry: string | null
  isPinned: boolean
  pinnedVersion: string | null
  isLocalDev: boolean
}

interface OpenCodeConfigShape {
  plugin?: string[]
}

function detectConfigPath(): string | null {
  const paths = getOpenCodeConfigPaths({ binary: "opencode", version: null })
  if (existsSync(paths.configJsonc)) return paths.configJsonc
  if (existsSync(paths.configJson)) return paths.configJson
  return null
}

function parsePluginVersion(entry: string): string | null {
  // Check for current package name
  if (entry.startsWith(`${PLUGIN_NAME}@`)) {
    const value = entry.slice(PLUGIN_NAME.length + 1)
    if (!value || value === "latest") return null
    return value
  }
  // Check for legacy package name
  if (entry.startsWith(`${LEGACY_PLUGIN_NAME}@`)) {
    const value = entry.slice(LEGACY_PLUGIN_NAME.length + 1)
    if (!value || value === "latest") return null
    return value
  }
  return null
}

function findPluginEntry(entries: string[]): { entry: string; isLocalDev: boolean } | null {
  for (const entry of entries) {
    // Check for current package name
    if (entry === PLUGIN_NAME || entry.startsWith(`${PLUGIN_NAME}@`)) {
      return { entry, isLocalDev: false }
    }
    // Check for legacy package name
    if (entry === LEGACY_PLUGIN_NAME || entry.startsWith(`${LEGACY_PLUGIN_NAME}@`)) {
      return { entry, isLocalDev: false }
    }
    // Check for file:// paths that include either name
    if (entry.startsWith("file://") && (entry.includes(PLUGIN_NAME) || entry.includes(LEGACY_PLUGIN_NAME))) {
      return { entry, isLocalDev: true }
    }
  }

  return null
}

export function getPluginInfo(): PluginInfo {
  const configPath = detectConfigPath()
  if (!configPath) {
    return {
      registered: false,
      configPath: null,
      entry: null,
      isPinned: false,
      pinnedVersion: null,
      isLocalDev: false,
    }
  }

  try {
    const content = readFileSync(configPath, "utf-8")
    const parsedConfig = parseJsonc<OpenCodeConfigShape>(content)
    const pluginEntry = findPluginEntry(parsedConfig.plugin ?? [])
    if (!pluginEntry) {
      return {
        registered: false,
        configPath,
        entry: null,
        isPinned: false,
        pinnedVersion: null,
        isLocalDev: false,
      }
    }

    const pinnedVersion = parsePluginVersion(pluginEntry.entry)
    return {
      registered: true,
      configPath,
      entry: pluginEntry.entry,
      isPinned: pinnedVersion !== null && /^\d+\.\d+\.\d+/.test(pinnedVersion ?? ""),
      pinnedVersion,
      isLocalDev: pluginEntry.isLocalDev,
    }
  } catch {
    return {
      registered: false,
      configPath,
      entry: null,
      isPinned: false,
      pinnedVersion: null,
      isLocalDev: false,
    }
  }
}

export { detectConfigPath, findPluginEntry }
