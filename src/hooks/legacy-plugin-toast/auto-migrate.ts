import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"

import { parseJsoncSafe } from "../../shared/jsonc-parser"
import { migrateLegacyPluginEntry } from "../../shared/migrate-legacy-plugin-entry"
import { getOpenCodeConfigPaths } from "../../shared/opencode-config-dir"
import { LEGACY_PLUGIN_NAME, PLUGIN_NAME } from "../../shared/plugin-identity"

export interface MigrationResult {
  migrated: boolean
  from: string | null
  to: string | null
  configPath: string | null
}

interface OpenCodeConfig {
  plugin?: string[]
}

function isLegacyEntry(entry: string): boolean {
  return entry === LEGACY_PLUGIN_NAME || entry.startsWith(`${LEGACY_PLUGIN_NAME}@`)
}

function toLegacyCanonical(entry: string): string {
  if (entry === LEGACY_PLUGIN_NAME) return PLUGIN_NAME
  if (entry.startsWith(`${LEGACY_PLUGIN_NAME}@`)) {
    return `${PLUGIN_NAME}${entry.slice(LEGACY_PLUGIN_NAME.length)}`
  }
  return entry
}

function detectOpenCodeConfigPath(overrideConfigDir?: string): string | null {
  if (overrideConfigDir) {
    const jsoncPath = join(overrideConfigDir, "opencode.jsonc")
    const jsonPath = join(overrideConfigDir, "opencode.json")
    if (existsSync(jsoncPath)) return jsoncPath
    if (existsSync(jsonPath)) return jsonPath
    return null
  }

  const paths = getOpenCodeConfigPaths({ binary: "opencode", version: null })
  if (existsSync(paths.configJsonc)) return paths.configJsonc
  if (existsSync(paths.configJson)) return paths.configJson
  return null
}

export function autoMigrateLegacyPluginEntry(overrideConfigDir?: string): MigrationResult {
  const configPath = detectOpenCodeConfigPath(overrideConfigDir)
  if (!configPath) return { migrated: false, from: null, to: null, configPath: null }

  try {
    const content = readFileSync(configPath, "utf-8")
    const parseResult = parseJsoncSafe<OpenCodeConfig>(content)
    if (!parseResult.data?.plugin) return { migrated: false, from: null, to: null, configPath }

    const plugins = parseResult.data.plugin
    const legacyEntries = plugins.filter(isLegacyEntry)
    if (legacyEntries.length === 0) return { migrated: false, from: null, to: null, configPath }

    const from = legacyEntries[0]
    const to = toLegacyCanonical(from)

    if (!migrateLegacyPluginEntry(configPath)) {
      return { migrated: false, from: null, to: null, configPath }
    }

    return { migrated: true, from, to, configPath }
  } catch {
    return { migrated: false, from: null, to: null, configPath }
  }
}
