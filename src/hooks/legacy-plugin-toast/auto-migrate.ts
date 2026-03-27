import { existsSync, readFileSync, writeFileSync } from "node:fs"

import { parseJsoncSafe } from "../../shared/jsonc-parser"
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

function isCanonicalEntry(entry: string): boolean {
  return entry === PLUGIN_NAME || entry.startsWith(`${PLUGIN_NAME}@`)
}

function toLegacyCanonical(entry: string): string {
  if (entry === LEGACY_PLUGIN_NAME) return PLUGIN_NAME
  if (entry.startsWith(`${LEGACY_PLUGIN_NAME}@`)) {
    return `${PLUGIN_NAME}${entry.slice(LEGACY_PLUGIN_NAME.length)}`
  }
  return entry
}

function detectOpenCodeConfigPath(): string | null {
  const paths = getOpenCodeConfigPaths({ binary: "opencode", version: null })
  if (existsSync(paths.configJsonc)) return paths.configJsonc
  if (existsSync(paths.configJson)) return paths.configJson
  return null
}

export function autoMigrateLegacyPluginEntry(): MigrationResult {
  const configPath = detectOpenCodeConfigPath()
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
    const to = toLegacyCanonical(from)

    const normalized = hasCanonical
      ? plugins.filter((p) => !isLegacyEntry(p))
      : plugins.map((p) => (isLegacyEntry(p) ? toLegacyCanonical(p) : p))

    const isJsonc = configPath.endsWith(".jsonc")
    if (isJsonc) {
      const pluginArrayRegex = /((?:"plugin"|plugin)\s*:\s*)\[([\s\S]*?)\]/
      const match = content.match(pluginArrayRegex)
      if (match) {
        const formattedPlugins = normalized.map((p) => `"${p}"`).join(",\n    ")
        const newContent = content.replace(pluginArrayRegex, `$1[\n    ${formattedPlugins}\n  ]`)
        writeFileSync(configPath, newContent)
        return { migrated: true, from, to, configPath }
      }
    }

    const parsed = JSON.parse(content) as Record<string, unknown>
    parsed.plugin = normalized
    writeFileSync(configPath, JSON.stringify(parsed, null, 2) + "\n")
    return { migrated: true, from, to, configPath }
  } catch {
    return { migrated: false, from: null, to: null, configPath }
  }
}
