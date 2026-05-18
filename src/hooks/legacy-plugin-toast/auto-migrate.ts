import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"

import { parseJsoncSafe } from "../../shared/jsonc-parser"
import { getOpenCodeConfigPaths } from "../../shared/opencode-config-dir"
import { PLUGIN_NAME } from "../../shared/plugin-identity"
import { isCanonicalEntry, isLegacyEntry, toCanonicalEntry } from "../../shared/plugin-entry-migrator"
import { migrateLegacyPluginEntry } from "./plugin-entry-migrator"

export interface MigrationResult {
  migrated: boolean
  from: string | null
  to: string | null
  configPath: string | null
}

interface OpenCodeConfig {
  plugin?: string[]
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

    const hasCanonical = plugins.some(isCanonicalEntry)
    const from = legacyEntries[0]
    const to = toCanonicalEntry(from)
    const migrated = migrateLegacyPluginEntry(configPath)
    if (!migrated) return { migrated: false, from: null, to: null, configPath }

    return {
      migrated: true,
      from,
      to: hasCanonical ? PLUGIN_NAME : to,
      configPath,
    }
  } catch {
    return { migrated: false, from: null, to: null, configPath }
  }
}
