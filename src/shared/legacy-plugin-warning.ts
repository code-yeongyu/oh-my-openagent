import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"

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
  configPath: string | null
}

function getOpenCodeConfigPath(overrideConfigDir?: string): string | null {
  if (overrideConfigDir) {
    const jsonPath = join(overrideConfigDir, "opencode.json")
    const jsoncPath = join(overrideConfigDir, "opencode.jsonc")
    if (existsSync(jsoncPath)) return jsoncPath
    if (existsSync(jsonPath)) return jsonPath
    return null
  }

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

export function checkForLegacyPluginEntry(overrideConfigDir?: string): LegacyPluginCheckResult {
  const configPath = getOpenCodeConfigPath(overrideConfigDir)
  if (!configPath) {
    return { hasLegacyEntry: false, hasCanonicalEntry: false, legacyEntries: [], configPath: null }
  }

  try {
    const content = readFileSync(configPath, "utf-8")
    const parseResult = parseJsoncSafe<OpenCodeConfig>(content)
    if (!parseResult.data) {
      return { hasLegacyEntry: false, hasCanonicalEntry: false, legacyEntries: [], configPath }
    }

    const legacyEntries = (parseResult.data.plugin ?? []).filter(isLegacyPluginEntry)
    const hasCanonicalEntry = (parseResult.data.plugin ?? []).some(isCanonicalPluginEntry)

    return {
      hasLegacyEntry: legacyEntries.length > 0,
      hasCanonicalEntry,
      legacyEntries,
      configPath,
    }
  } catch {
    return { hasLegacyEntry: false, hasCanonicalEntry: false, legacyEntries: [], configPath: null }
  }
}
