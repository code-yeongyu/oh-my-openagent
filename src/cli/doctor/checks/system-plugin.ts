import { existsSync, readFileSync } from "node:fs"
import { getOpenCodeConfigPaths, parseJsonc } from "../../../shared"
import { LEGACY_NPM_PACKAGE_NAME, NPM_PACKAGE_NAME } from "../constants"

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
  for (const name of [NPM_PACKAGE_NAME, LEGACY_NPM_PACKAGE_NAME]) {
    if (entry.startsWith(`${name}@`)) {
      const value = entry.slice(name.length + 1)
      if (!value || value === "latest") return null
      return value
    }
  }
  return null
}

function matchesPluginName(entry: string, name: string): boolean {
  return entry === name || entry.startsWith(`${name}@`)
}

function findPluginEntry(entries: string[]): { entry: string; isLocalDev: boolean } | null {
  for (const entry of entries) {
    if (matchesPluginName(entry, NPM_PACKAGE_NAME) || matchesPluginName(entry, LEGACY_NPM_PACKAGE_NAME)) {
      return { entry, isLocalDev: false }
    }
    if (entry.startsWith("file://") && entry.includes(NPM_PACKAGE_NAME)) {
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
