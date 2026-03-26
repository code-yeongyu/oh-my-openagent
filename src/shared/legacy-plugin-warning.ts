import { existsSync, readFileSync } from "node:fs"

import { parseJsoncSafe } from "./jsonc-parser"
import { getOpenCodeConfigPaths } from "./opencode-config-dir"
import { LEGACY_PLUGIN_NAME, PLUGIN_NAME } from "./plugin-identity"

interface OpenCodeConfig {
  plugin?: string[]
}

export interface LegacyPluginCheckResult {
  hasLegacyEntry: boolean
  hasCanonicalEntry: boolean
  legacyEntries: string[]
}

function getOpenCodeConfigPath(): string | null {
  const { configJsonc, configJson } = getOpenCodeConfigPaths({ binary: "opencode", version: null })

  if (existsSync(configJsonc)) return configJsonc
  if (existsSync(configJson)) return configJson
  return null
}

function isLegacyPluginEntry(entry: string): boolean {
  return entry === LEGACY_PLUGIN_NAME || entry.startsWith(`${LEGACY_PLUGIN_NAME}@`)
}

function isCanonicalPluginEntry(entry: string): boolean {
  return entry === PLUGIN_NAME || entry.startsWith(`${PLUGIN_NAME}@`)
}

export function checkForLegacyPluginEntry(): LegacyPluginCheckResult {
  const configPath = getOpenCodeConfigPath()
  if (!configPath) {
    return { hasLegacyEntry: false, hasCanonicalEntry: false, legacyEntries: [] }
  }

  try {
    const content = readFileSync(configPath, "utf-8")
    const parseResult = parseJsoncSafe<OpenCodeConfig>(content)
    if (!parseResult.data) {
      return { hasLegacyEntry: false, hasCanonicalEntry: false, legacyEntries: [] }
    }

    const legacyEntries = (parseResult.data.plugin ?? []).filter(isLegacyPluginEntry)
    const hasCanonicalEntry = (parseResult.data.plugin ?? []).some(isCanonicalPluginEntry)

    return {
      hasLegacyEntry: legacyEntries.length > 0,
      hasCanonicalEntry,
      legacyEntries,
    }
  } catch {
    return { hasLegacyEntry: false, hasCanonicalEntry: false, legacyEntries: [] }
  }
}
