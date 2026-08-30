import { existsSync, readFileSync } from "node:fs"

import {
  LEGACY_PLUGIN_NAME,
  PLUGIN_NAME,
  getOpenCodeConfigPaths,
  getPluginEntryName,
  parseJsonc,
  type PluginEntry,
} from "../../../shared"

export interface PluginInfo {
  registered: boolean
  configPath: string | null
  entry: PluginEntry | null
  isPinned: boolean
  pinnedVersion: string | null
  isLocalDev: boolean
}

interface OpenCodeConfigShape {
  plugin?: PluginEntry[]
}

function detectConfigPath(): string | null {
  const paths = getOpenCodeConfigPaths({ binary: "opencode", version: null })
  if (existsSync(paths.configJsonc)) return paths.configJsonc
  if (existsSync(paths.configJson)) return paths.configJson
  return null
}

function parsePluginVersion(entry: PluginEntry): string | null {
  const name = getPluginEntryName(entry)
  if (name.startsWith(`${PLUGIN_NAME}@`)) {
    const value = name.slice(PLUGIN_NAME.length + 1)
    if (!value || value === "latest") return null
    return value
  }
  if (name.startsWith(`${LEGACY_PLUGIN_NAME}@`)) {
    const value = name.slice(LEGACY_PLUGIN_NAME.length + 1)
    if (!value || value === "latest") return null
    return value
  }
  return null
}

function findPluginEntry(entries: PluginEntry[]): { entry: PluginEntry; isLocalDev: boolean } | null {
  for (const entry of entries) {
    const name = getPluginEntryName(entry)
    if (name === PLUGIN_NAME || name.startsWith(`${PLUGIN_NAME}@`)) {
      return { entry, isLocalDev: false }
    }
    if (name === LEGACY_PLUGIN_NAME || name.startsWith(`${LEGACY_PLUGIN_NAME}@`)) {
      return { entry, isLocalDev: false }
    }
    if (name.startsWith("file://") && (name.includes(PLUGIN_NAME) || name.includes(LEGACY_PLUGIN_NAME))) {
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
  } catch (error) {
    if (!(error instanceof Error)) {
      throw error
    }

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
