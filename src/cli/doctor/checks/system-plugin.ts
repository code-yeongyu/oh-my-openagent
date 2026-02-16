import { existsSync, readFileSync } from "node:fs"

import { PACKAGE_NAME } from "../constants"
import { getOpenCodeConfigPaths, parseJsonc } from "../../../shared"

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
  if (!entry.startsWith(`${PACKAGE_NAME}@`)) return null
  const value = entry.slice(PACKAGE_NAME.length + 1)
  if (!value || value === "latest") return null
  return value
}

function findPluginEntry(entries: string[]): { entry: string; isLocalDev: boolean } | null {
  for (const entry of entries) {
    if (entry === PACKAGE_NAME || entry.startsWith(`${PACKAGE_NAME}@`)) {
      return { entry, isLocalDev: false }
    }
    if (entry.startsWith("file://") && entry.includes(PACKAGE_NAME)) {
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
      isPinned: pinnedVersion !== null,
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
