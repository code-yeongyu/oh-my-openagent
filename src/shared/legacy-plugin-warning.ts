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

function getConfigPathFromDirectory(configDir: string): string | null {
  const jsonPath = join(configDir, "opencode.json")
  const jsoncPath = join(configDir, "opencode.jsonc")

  if (existsSync(jsoncPath)) return jsoncPath
  if (existsSync(jsonPath)) return jsonPath
  return null
}

function getOpenCodeConfigPathsToCheck(overrideConfigDir?: string, projectDir?: string): string[] {
  if (overrideConfigDir) {
    const overridePath = getConfigPathFromDirectory(overrideConfigDir)
    return overridePath ? [overridePath] : []
  }

  const configPaths: string[] = []

  if (projectDir) {
    const projectConfigPath = getConfigPathFromDirectory(join(projectDir, ".opencode"))
    if (projectConfigPath) {
      configPaths.push(projectConfigPath)
    }
  }

  const { configJsonc, configJson } = getOpenCodeConfigPaths({ binary: "opencode", version: null })

  if (existsSync(configJsonc)) configPaths.push(configJsonc)
  else if (existsSync(configJson)) configPaths.push(configJson)

  return configPaths
}

function isLegacyPluginEntry(entry: string): boolean {
  return entry === LEGACY_PLUGIN_NAME || entry.startsWith(`${LEGACY_PLUGIN_NAME}@`)
}

function isCanonicalPluginEntry(entry: string): boolean {
  return entry === PLUGIN_NAME || entry.startsWith(`${PLUGIN_NAME}@`)
}

export function checkForLegacyPluginEntry(
  overrideConfigDir?: string,
  projectDir?: string,
): LegacyPluginCheckResult {
  const configPaths = getOpenCodeConfigPathsToCheck(overrideConfigDir, projectDir)
  if (configPaths.length === 0) {
    return { hasLegacyEntry: false, hasCanonicalEntry: false, legacyEntries: [], configPath: null }
  }

  let hasCanonicalEntry = false
  let detectedConfigPath: string | null = null

  for (const configPath of configPaths) {
    detectedConfigPath ??= configPath

    try {
      const content = readFileSync(configPath, "utf-8")
      const parseResult = parseJsoncSafe<OpenCodeConfig>(content)
      if (!parseResult.data) {
        continue
      }

      const pluginEntries = parseResult.data.plugin ?? []
      const legacyEntries = pluginEntries.filter(isLegacyPluginEntry)
      const fileHasCanonicalEntry = pluginEntries.some(isCanonicalPluginEntry)

      if (legacyEntries.length > 0) {
        return {
          hasLegacyEntry: true,
          hasCanonicalEntry: fileHasCanonicalEntry,
          legacyEntries,
          configPath,
        }
      }

      hasCanonicalEntry ||= fileHasCanonicalEntry
    } catch {
      continue
    }
  }

  return {
    hasLegacyEntry: false,
    hasCanonicalEntry,
    legacyEntries: [],
    configPath: detectedConfigPath,
  }
}
